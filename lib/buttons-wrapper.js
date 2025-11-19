/*

buttons-wrapper.js

Enhanced wrapper utilities for WhiskeySockets (Baileys fork) to send

WhatsApp interactive buttons / native flow messages reliably —

production-ready, with optional header image and link-preview support.

Features added beyond the original:

Header image support (pass a jpegThumbnail Buffer or base64 string).


Basic link preview (externalAdReply) attachment for text/extended text messages.


Improved defensive checks, clearer logs, and more robust option merging.


NOTE: This helper attempts to use generateWAMessageFromContent and relayMessage

from the installed baileys / whiskeysockets package. It mutates the generated

WAMessage to insert contextInfo (externalAdReply) for link previews when

requested. Because different baileys versions may expose internals differently,

this file includes dynamic lookups and helpful errors if required functions are

missing. The helper is intentionally permissive about header image formats —

you may pass a Buffer, a base64 string, or a plain object matching Baileys'

imageMessage shape (see comments below). */


'use strict';

// -------------------- Helper / Validation utilities (same as previously provided) -------------------- function buildInteractiveButtons(buttons = []) { return buttons.map((b, i) => { if (b && b.name && b.buttonParamsJson) return b; if (b && (b.id || b.text)) { return { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: b.text || b.displayText || 'Button ' + (i + 1), id: b.id || ('quick_' + (i + 1)) }) }; } if (b && b.buttonId && b.buttonText?.displayText) { return { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: b.buttonText.displayText, id: b.buttonId }) }; } return b; }); }

function validateAuthoringButtons(buttons) { const errors = []; const warnings = []; if (buttons == null) { return { errors: [], warnings: [], valid: true, cleaned: [] }; } if (!Array.isArray(buttons)) { errors.push('buttons must be an array'); return { errors, warnings, valid: false, cleaned: [] }; } const SOFT_BUTTON_CAP = 25; if (buttons.length === 0) { warnings.push('buttons array is empty'); } else if (buttons.length > SOFT_BUTTON_CAP) { warnings.push(buttons count (${buttons.length}) exceeds soft cap of ${SOFT_BUTTON_CAP}; may be rejected by client); }

const cleaned = buttons.map((b, idx) => { if (b == null || typeof b !== 'object') { errors.push(button[${idx}] is not an object); return b; } if (b.name && b.buttonParamsJson) { if (typeof b.buttonParamsJson !== 'string') { errors.push(button[${idx}] buttonParamsJson must be string); } else { try { JSON.parse(b.buttonParamsJson); } catch (e) { errors.push(button[${idx}] buttonParamsJson is not valid JSON: ${e.message}); } } return b; } if (b.id || b.text || b.displayText) { return b; } if (b.buttonId && b.buttonText && typeof b.buttonText === 'object' && b.buttonText.displayText) { return b; } if (b.buttonParamsJson) { if (typeof b.buttonParamsJson !== 'string') { warnings.push(button[${idx}] has non-string buttonParamsJson; will attempt to stringify); try { b.buttonParamsJson = JSON.stringify(b.buttonParamsJson); } catch { errors.push(button[${idx}] buttonParamsJson could not be serialized); } } else { try { JSON.parse(b.buttonParamsJson); } catch (e) { warnings.push(button[${idx}] buttonParamsJson not valid JSON (${e.message})); } } if (!b.name) { warnings.push(button[${idx}] missing name; defaulting to quick_reply); b.name = 'quick_reply'; } return b; } warnings.push(button[${idx}] unrecognized shape; passing through unchanged); return b; });

return { errors, warnings, valid: errors.length === 0, cleaned }; }

class InteractiveValidationError extends Error { constructor(message, { context, errors = [], warnings = [], example } = {}) { super(message); this.name = 'InteractiveValidationError'; this.context = context; this.errors = errors; this.warnings = warnings; this.example = example; } toJSON() { return { name: this.name, message: this.message, context: this.context, errors: this.errors, warnings: this.warnings, example: this.example }; } formatDetailed() { const lines = [[${this.name}] ${this.message}${this.context ? ' (' + this.context + ')' : ''}]; if (this.errors?.length) { lines.push('Errors:'); this.errors.forEach(e => lines.push('  - ' + e)); } if (this.warnings?.length) { lines.push('Warnings:'); this.warnings.forEach(w => lines.push('  - ' + w)); } if (this.example) { lines.push('Example payload:', JSON.stringify(this.example, null, 2)); } return lines.join('\n'); } }

const EXAMPLE_PAYLOADS = { sendButtons: { text: 'Choose an option', buttons: [ { id: 'opt1', text: 'Option 1' }, { id: 'opt2', text: 'Option 2' }, { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: 'Visit Site', url: 'https://example.com' }) } ], footer: 'Footer text' }, sendInteractiveMessage: { text: 'Pick an action', interactiveButtons: [ { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'Hello', id: 'hello' }) }, { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: 'Copy Code', copy_code: 'ABC123' }) } ], footer: 'Footer' } };

const SEND_BUTTONS_ALLOWED_COMPLEX = new Set(['cta_url', 'cta_copy', 'cta_call']); const INTERACTIVE_ALLOWED_NAMES = new Set([ 'quick_reply', 'cta_url', 'cta_copy', 'cta_call', 'cta_catalog', 'cta_reminder', 'cta_cancel_reminder', 'address_message', 'send_location', 'open_webview', 'mpm', 'wa_payment_transaction_details', 'automated_greeting_message_view_catalog', 'galaxy_message', 'single_select' ]);

const REQUIRED_FIELDS_MAP = { cta_url: ['display_text', 'url'], cta_copy: ['display_text', 'copy_code'], cta_call: ['display_text', 'phone_number'], cta_catalog: ['business_phone_number'], cta_reminder: ['display_text'], cta_cancel_reminder: ['display_text'], address_message: ['display_text'], send_location: ['display_text'], open_webview: ['title', 'link'], mpm: ['product_id'], wa_payment_transaction_details: ['transaction_id'], automated_greeting_message_view_catalog: ['business_phone_number', 'catalog_product_id'], galaxy_message: ['flow_token', 'flow_id'], single_select: ['title', 'sections'], quick_reply: ['display_text', 'id'] };

function parseButtonParams(name, buttonParamsJson, errors, warnings, index) { let parsed; try { parsed = JSON.parse(buttonParamsJson); } catch (e) { errors.push(button[${index}] (${name}) invalid JSON: ${e.message}); return null; } const req = REQUIRED_FIELDS_MAP[name] || []; for (const f of req) { if (!(f in parsed)) { errors.push(button[${index}] (${name}) missing required field '${f}'); } } if (name === 'open_webview' && parsed.link) { if (typeof parsed.link !== 'object' || !parsed.link.url) { errors.push(button[${index}] (open_webview) link.url required); } } if (name === 'single_select') { if (!Array.isArray(parsed.sections) || parsed.sections.length === 0) { errors.push(button[${index}] (single_select) sections must be non-empty array); } } return parsed; }

function validateSendButtonsPayload(data) { const errors = []; const warnings = []; if (!data || typeof data !== 'object') { return { valid: false, errors: ['payload must be an object'], warnings }; } if (!data.text || typeof data.text !== 'string') { errors.push('text is mandatory and must be a string'); } if (!Array.isArray(data.buttons) || data.buttons.length === 0) { errors.push('buttons is mandatory and must be a non-empty array'); } else { data.buttons.forEach((btn, i) => { if (!btn || typeof btn !== 'object') { errors.push(button[${i}] must be an object); return; } if (btn.id && btn.text) { if (typeof btn.id !== 'string' || typeof btn.text !== 'string') { errors.push(button[${i}] legacy quick reply id/text must be strings); } return; } if (btn.name && btn.buttonParamsJson) { if (!SEND_BUTTONS_ALLOWED_COMPLEX.has(btn.name)) { errors.push(button[${i}] name '${btn.name}' not allowed in sendButtons); return; } if (typeof btn.buttonParamsJson !== 'string') { errors.push(button[${i}] buttonParamsJson must be string); return; } parseButtonParams(btn.name, btn.buttonParamsJson, errors, warnings, i); return; } errors.push(button[${i}] invalid shape (must be legacy quick reply or named ${Array.from(SEND_BUTTONS_ALLOWED_COMPLEX).join(', ')})); }); } return { valid: errors.length === 0, errors, warnings }; }

function validateSendInteractiveMessagePayload(data) { const errors = []; const warnings = []; if (!data || typeof data !== 'object') { return { valid: false, errors: ['payload must be an object'], warnings }; } if (!data.text || typeof data.text !== 'string') { errors.push('text is mandatory and must be a string'); } if (!Array.isArray(data.interactiveButtons) || data.interactiveButtons.length === 0) { errors.push('interactiveButtons is mandatory and must be a non-empty array'); } else { data.interactiveButtons.forEach((btn, i) => { if (!btn || typeof btn !== 'object') { errors.push(interactiveButtons[${i}] must be an object); return; } if (!btn.name || typeof btn.name !== 'string') { errors.push(interactiveButtons[${i}] missing name); return; } if (!INTERACTIVE_ALLOWED_NAMES.has(btn.name)) { errors.push(interactiveButtons[${i}] name '${btn.name}' not allowed); return; } if (!btn.buttonParamsJson || typeof btn.buttonParamsJson !== 'string') { errors.push(interactiveButtons[${i}] buttonParamsJson must be string); return; } parseButtonParams(btn.name, btn.buttonParamsJson, errors, warnings, i); }); } return { valid: errors.length === 0, errors, warnings }; }

function validateInteractiveMessageContent(content) { const errors = []; const warnings = []; if (!content || typeof content !== 'object') { return { errors: ['content must be an object'], warnings, valid: false }; } const interactive = content.interactiveMessage; if (!interactive) { return { errors, warnings, valid: true }; } const nativeFlow = interactive.nativeFlowMessage; if (!nativeFlow) { errors.push('interactiveMessage.nativeFlowMessage missing'); return { errors, warnings, valid: false }; } if (!Array.isArray(nativeFlow.buttons)) { errors.push('nativeFlowMessage.buttons must be an array'); return { errors, warnings, valid: false }; } if (nativeFlow.buttons.length === 0) { warnings.push('nativeFlowMessage.buttons is empty'); } nativeFlow.buttons.forEach((btn, i) => { if (!btn || typeof btn !== 'object') { errors.push(buttons[${i}] is not an object); return; } if (!btn.buttonParamsJson) { warnings.push(buttons[${i}] missing buttonParamsJson (may fail to render)); } else if (typeof btn.buttonParamsJson !== 'string') { errors.push(buttons[${i}] buttonParamsJson must be string); } else { try { JSON.parse(btn.buttonParamsJson); } catch (e) { warnings.push(buttons[${i}] buttonParamsJson invalid JSON (${e.message})); } } if (!btn.name) { warnings.push(buttons[${i}] missing name; defaulting to quick_reply); btn.name = 'quick_reply'; } }); return { errors, warnings, valid: errors.length === 0 }; }

function getButtonType(message) { if (message.listMessage) return 'list'; else if (message.buttonsMessage) return 'buttons'; else if (message.interactiveMessage?.nativeFlowMessage) return 'native_flow'; return null; }

function getButtonArgs(message) { const nativeFlow = message.interactiveMessage?.nativeFlowMessage; const firstButtonName = nativeFlow?.buttons?.[0]?.name; const nativeFlowSpecials = [ 'mpm', 'cta_catalog', 'send_location', 'call_permission_request', 'wa_payment_transaction_details', 'automated_greeting_message_view_catalog' ];

if (nativeFlow && (firstButtonName === 'review_and_pay' || firstButtonName === 'payment_info')) { return { tag: 'biz', attrs: { native_flow_name: firstButtonName === 'review_and_pay' ? 'order_details' : firstButtonName } }; } else if (nativeFlow && nativeFlowSpecials.includes(firstButtonName)) { return { tag: 'biz', attrs: {}, content: [{ tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, content: [{ tag: 'native_flow', attrs: { v: '2', name: firstButtonName } }] }] }; } else if (nativeFlow || message.buttonsMessage) { return { tag: 'biz', attrs: {}, content: [{ tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }] }] }; } else if (message.listMessage) { return { tag: 'biz', attrs: {}, content: [{ tag: 'list', attrs: { v: '2', type: 'product_list' } }] }; } else { return { tag: 'biz', attrs: {} }; } }

// -------------------- Conversion helpers -------------------- function convertToInteractiveMessage(content) { const newContent = { ...content }; if (content.interactiveButtons && content.interactiveButtons.length > 0) { const interactiveMessage = { nativeFlowMessage: { buttons: content.interactiveButtons.map(btn => ({ name: btn.name || 'quick_reply', buttonParamsJson: btn.buttonParamsJson })) } }; if (content.title || content.subtitle) interactiveMessage.header = { title: content.title || content.subtitle || '' }; if (content.text) interactiveMessage.body = { text: content.text }; if (content.footer) interactiveMessage.footer = { text: content.footer }; // If headerImage present, allow caller to pass either: //  - headerImage.jpegThumbnail (Buffer or base64 string) //  - headerImage.imageMessage (complete imageMessage object compatible with Baileys) if (content.headerImage) { interactiveMessage.header = interactiveMessage.header || {}; // If caller provided raw imageMessage shape, trust it. if (content.headerImage.imageMessage) { interactiveMessage.header.imageMessage = content.headerImage.imageMessage; } else { // Try to create a minimal imageMessage using jpegThumbnail const thumb = content.headerImage.jpegThumbnail || content.headerImage.thumbnailBase64; if (thumb) { let jpegThumbBuf = thumb; if (typeof thumb === 'string') { // base64 string try { jpegThumbBuf = Buffer.from(thumb, 'base64'); } catch (e) { jpegThumbBuf = null; } } if (jpegThumbBuf && Buffer.isBuffer(jpegThumbBuf)) { interactiveMessage.header.imageMessage = { mimetype: content.headerImage.mimetype || 'image/jpeg', jpegThumbnail: jpegThumbBuf }; } } } } delete newContent.interactiveButtons; delete newContent.title; delete newContent.subtitle; delete newContent.text; delete newContent.footer; delete newContent.headerImage; return { ...newContent, interactiveMessage }; } return content; }

// -------------------- Core send helper -------------------- async function sendInteractiveMessage(sock, jid, content, options = {}) { if (!sock) throw new InteractiveValidationError('Socket is required', { context: 'sendInteractiveMessage' });

if (content && Array.isArray(content.interactiveButtons)) { const strict = validateSendInteractiveMessagePayload(content); if (!strict.valid) { throw new InteractiveValidationError('Interactive authoring payload invalid', { context: 'sendInteractiveMessage.validateSendInteractiveMessagePayload', errors: strict.errors, warnings: strict.warnings, example: EXAMPLE_PAYLOADS.sendInteractiveMessage }); } if (strict.warnings.length) console.warn('sendInteractiveMessage warnings:', strict.warnings); }

const convertedContent = convertToInteractiveMessage(content); const { errors: contentErrors, warnings: contentWarnings, valid: contentValid } = validateInteractiveMessageContent(convertedContent); if (!contentValid) { throw new InteractiveValidationError('Converted interactive content invalid', { context: 'sendInteractiveMessage.validateInteractiveMessageContent', errors: contentErrors, warnings: contentWarnings, example: convertToInteractiveMessage(EXAMPLE_PAYLOADS.sendInteractiveMessage) }); } if (contentWarnings.length) console.warn('Interactive content warnings:', contentWarnings);

// Attempt to locate required baileys helpers dynamically let generateWAMessageFromContent, relayMessage, normalizeMessageContent, isJidGroup, generateMessageIDV2; const candidatePkgs = ['baileys', '@whiskeysockets/baileys', '@adiwajshing/baileys']; let loaded = false; for (const pkg of candidatePkgs) { if (loaded) break; try { const mod = require(pkg); generateWAMessageFromContent = mod.generateWAMessageFromContent || mod.Utils?.generateWAMessageFromContent; normalizeMessageContent = mod.normalizeMessageContent || mod.Utils?.normalizeMessageContent; isJidGroup = mod.isJidGroup || mod.WABinary?.isJidGroup; generateMessageIDV2 = mod.generateMessageIDV2 || mod.Utils?.generateMessageIDV2 || mod.generateMessageID || mod.Utils?.generateMessageID; relayMessage = sock.relayMessage; if (generateWAMessageFromContent && normalizeMessageContent && isJidGroup && relayMessage) loaded = true; } catch (_) { /* try next */ } } if (!loaded) { throw new InteractiveValidationError('Missing baileys internals', { context: 'sendInteractiveMessage.dynamicImport', errors: ['generateWAMessageFromContent or normalizeMessageContent not found in installed packages: baileys / @whiskeysockets/baileys / @adiwajshing/baileys'], example: { install: 'npm i baileys', requireUsage: "const { generateWAMessageFromContent } = require('baileys')" } }); }

// Build the WAMessage manually const userJid = sock.authState?.creds?.me?.id || sock.user?.id; const messageId = (typeof generateMessageIDV2 === 'function') ? generateMessageIDV2(userJid) : undefined; const fullMsg = generateWAMessageFromContent(jid, convertedContent, { logger: sock.logger, userJid, messageId, timestamp: new Date(), ...options });

// Optionally attach externalAdReply for link preview if provided via options.linkPreview if (options.linkPreview && typeof options.linkPreview === 'object') { try { const preview = options.linkPreview; // expected: { title, description, canonicalUrl, thumbnailBase64 } const externalAdReply = { title: preview.title || undefined, body: preview.description || undefined, mediaType: preview.mediaType || 1, thumbnail: undefined, sourceUrl: preview.canonicalUrl || undefined }; if (preview.thumbnailBase64) { try { externalAdReply.thumbnail = Buffer.from(preview.thumbnailBase64, 'base64'); } catch (e) { /* ignore */ } }

// Attach to extendedTextMessage.contextInfo or conversation -> extendedTextMessage
  if (fullMsg.message.extendedTextMessage) {
    fullMsg.message.extendedTextMessage.contextInfo = fullMsg.message.extendedTextMessage.contextInfo || {};
    fullMsg.message.extendedTextMessage.contextInfo.externalAdReply = externalAdReply;
  } else if (fullMsg.message.conversation) {
    // Some baileys builds place plain text under conversation — convert it into extendedTextMessage to attach context
    const text = fullMsg.message.conversation;
    delete fullMsg.message.conversation;
    fullMsg.message.extendedTextMessage = { text, contextInfo: { externalAdReply } };
  } else {
    // Try to find any text-like key and attach context
    const msgKeys = Object.keys(fullMsg.message);
    const key = msgKeys.find(k => fullMsg.message[k]?.text || typeof fullMsg.message[k] === 'string');
    if (key && fullMsg.message[key]) {
      fullMsg.message[key].contextInfo = fullMsg.message[key].contextInfo || {};
      fullMsg.message[key].contextInfo.externalAdReply = externalAdReply;
    }
  }
} catch (e) { console.warn('Failed to attach link preview:', e?.message || e); }

}

// Inspect normalized content and compute additionalNodes const normalizedContent = normalizeMessageContent(fullMsg.message); const buttonType = getButtonType(normalizedContent); let additionalNodes = [...(options.additionalNodes || [])]; if (buttonType) { const buttonsNode = getButtonArgs(normalizedContent); const isPrivate = !isJidGroup(jid); additionalNodes.push(buttonsNode); if (isPrivate) additionalNodes.push({ tag: 'bot', attrs: { biz_bot: '1' } }); console.log('Interactive send:', { type: buttonType, nodes: additionalNodes.map(n => ({ tag: n.tag, attrs: n.attrs })), private: isPrivate }); }

// Relay message await relayMessage(jid, fullMsg.message, { messageId: fullMsg.key.id, useCachedGroupMetadata: options.useCachedGroupMetadata, additionalAttributes: options.additionalAttributes || {}, statusJidList: options.statusJidList, additionalNodes });

// Optionally emit to local event stream for immediate local visibility const isPrivateChat = !isJidGroup(jid); if (sock.config?.emitOwnEvents && isPrivateChat) { process.nextTick(() => { try { if (sock.processingMutex?.mutex && sock.upsertMessage) { sock.processingMutex.mutex(() => sock.upsertMessage(fullMsg, 'append')); } else if (sock.upsertMessage) { sock.upsertMessage(fullMsg, 'append'); } } catch (e) { /* swallow */ } }); }

return fullMsg; }

// -------------------- Convenience wrapper for quick replies + image/link support -------------------- async function sendInteractiveButtonsBasic(sock, jid, data = {}, options = {}) { if (!sock) throw new InteractiveValidationError('Socket is required', { context: 'sendButtons' }); const { text = '', footer = '', title, subtitle, buttons = [], headerImage } = data;

const strict = validateSendButtonsPayload({ text, buttons, title, subtitle, footer }); if (!strict.valid) { throw new InteractiveValidationError('Buttons payload invalid', { context: 'sendButtons.validateSendButtonsPayload', errors: strict.errors, warnings: strict.warnings, example: EXAMPLE_PAYLOADS.sendButtons }); } if (strict.warnings.length) console.warn('sendButtons warnings:', strict.warnings);

const { errors, warnings, cleaned } = validateAuthoringButtons(buttons); if (errors.length) { throw new InteractiveValidationError('Authoring button objects invalid', { context: 'sendButtons.validateAuthoringButtons', errors, warnings, example: EXAMPLE_PAYLOADS.sendButtons.buttons }); } if (warnings.length) console.warn('Button validation warnings:', warnings);

const interactiveButtons = buildInteractiveButtons(cleaned);

const payload = { text, footer, interactiveButtons }; if (title) payload.title = title; if (subtitle) payload.subtitle = subtitle; if (headerImage) payload.headerImage = headerImage; // consumed by convertToInteractiveMessage

// If user passed linkPreview inside data, prefer that over options if (data.linkPreview) options = { ...options, linkPreview: data.linkPreview };

return sendInteractiveMessage(sock, jid, payload, options); }

// Backwards-compatible alias for older code that expects sendButtons const sendButtons = sendInteractiveButtonsBasic;

module.exports = { sendButtons, sendInteractiveMessage, getButtonType, getButtonArgs, InteractiveValidationError, validateAuthoringButtons, validateInteractiveMessageContent, validateSendButtonsPayload, validateSendInteractiveMessagePayload, };
