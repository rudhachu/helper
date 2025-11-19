/**
 * Enhanced wrapper utilities to enable WhiskeySockets (Baileys fork) to send
 * WhatsApp interactive buttons / native flow messages reliably, with optional image support.
 */

const EXAMPLE_PAYLOADS = {
  sendButtons: {
    text: 'Choose an option',
    buttons: [
      { id: 'opt1', text: 'Option 1' },
      { id: 'opt2', text: 'Option 2' },
      { name: 'cta_url', buttonParamsJson: JSON.stringify({ display_text: 'Visit Site', url: 'https://example.com' }) }
    ],
    footer: 'Footer text'
  },
  sendInteractiveMessage: {
    text: 'Pick an action',
    interactiveButtons: [
      { name: 'quick_reply', buttonParamsJson: JSON.stringify({ display_text: 'Hello', id: 'hello' }) },
      { name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: 'Copy Code', copy_code: 'ABC123' }) }
    ],
    footer: 'Footer'
  }
};

// -------------------- BUTTON NORMALIZATION --------------------
function buildInteractiveButtons(buttons = []) {
  return buttons.map((b, i) => {
    if (b && b.name && b.buttonParamsJson) return b;

    if (b && (b.id || b.text)) {
      return {
        name: 'quick_reply',
        buttonParamsJson: JSON.stringify({
          display_text: b.text || b.displayText || 'Button ' + (i + 1),
          id: b.id || ('quick_' + (i + 1))
        })
      };
    }

    if (b && b.buttonId && b.buttonText?.displayText) {
      return {
        name: 'quick_reply',
        buttonParamsJson: JSON.stringify({
          display_text: b.buttonText.displayText,
          id: b.buttonId
        })
      };
    }

    return b;
  });
}

// -------------------- VALIDATION --------------------
function validateAuthoringButtons(buttons) {
  const errors = [];
  const warnings = [];
  if (!buttons) return { errors, warnings, valid: true, cleaned: [] };
  if (!Array.isArray(buttons)) return { errors: ['buttons must be an array'], warnings, valid: false, cleaned: [] };

  const SOFT_BUTTON_CAP = 25;
  if (buttons.length === 0) warnings.push('buttons array is empty');
  else if (buttons.length > SOFT_BUTTON_CAP) warnings.push(`buttons count (${buttons.length}) exceeds soft cap of ${SOFT_BUTTON_CAP}`);

  const cleaned = buttons.map((b, idx) => {
    if (!b || typeof b !== 'object') { errors.push(`button[${idx}] is not an object`); return b; }
    if (b.name && b.buttonParamsJson) {
      if (typeof b.buttonParamsJson !== 'string') errors.push(`button[${idx}] buttonParamsJson must be string`);
      else try { JSON.parse(b.buttonParamsJson); } catch (e) { errors.push(`button[${idx}] buttonParamsJson invalid JSON: ${e.message}`); }
      return b;
    }
    if (b.id || b.text || b.displayText) return b;
    if (b.buttonId && b.buttonText?.displayText) return b;
    if (b.buttonParamsJson) {
      if (typeof b.buttonParamsJson !== 'string') try { b.buttonParamsJson = JSON.stringify(b.buttonParamsJson); } catch { errors.push(`button[${idx}] buttonParamsJson could not be serialized`); }
      if (!b.name) b.name = 'quick_reply';
      return b;
    }
    warnings.push(`button[${idx}] unrecognized shape; passing through unchanged`);
    return b;
  });

  return { errors, warnings, valid: errors.length === 0, cleaned };
}

class InteractiveValidationError extends Error {
  constructor(message, { context, errors = [], warnings = [], example } = {}) {
    super(message);
    this.name = 'InteractiveValidationError';
    this.context = context;
    this.errors = errors;
    this.warnings = warnings;
    this.example = example;
  }
  toJSON() { return { name: this.name, message: this.message, context: this.context, errors: this.errors, warnings: this.warnings, example: this.example }; }
  formatDetailed() {
    const lines = [`[${this.name}] ${this.message}${this.context ? ' (' + this.context + ')' : ''}`];
    if (this.errors?.length) { lines.push('Errors:'); this.errors.forEach(e => lines.push('  - ' + e)); }
    if (this.warnings?.length) { lines.push('Warnings:'); this.warnings.forEach(w => lines.push('  - ' + w)); }
    if (this.example) lines.push('Example payload:', JSON.stringify(this.example, null, 2));
    return lines.join('\n');
  }
}

// -------------------- BUTTON TYPE / NODE HELPERS --------------------
function getButtonType(message) {
  if (message.listMessage) return 'list';
  if (message.buttonsMessage) return 'buttons';
  if (message.interactiveMessage?.nativeFlowMessage) return 'native_flow';
  return null;
}

function getButtonArgs(message) {
  const nativeFlow = message.interactiveMessage?.nativeFlowMessage;
  const firstButtonName = nativeFlow?.buttons?.[0]?.name;
  const nativeFlowSpecials = ['mpm', 'cta_catalog', 'send_location', 'call_permission_request', 'wa_payment_transaction_details', 'automated_greeting_message_view_catalog'];

  if (nativeFlow && (firstButtonName === 'review_and_pay' || firstButtonName === 'payment_info')) {
    return { tag: 'biz', attrs: { native_flow_name: firstButtonName === 'review_and_pay' ? 'order_details' : firstButtonName } };
  } else if (nativeFlow && nativeFlowSpecials.includes(firstButtonName)) {
    return { tag: 'biz', attrs: {}, content: [{ tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, content: [{ tag: 'native_flow', attrs: { v: '2', name: firstButtonName } }] }] };
  } else if (nativeFlow || message.buttonsMessage) {
    return { tag: 'biz', attrs: {}, content: [{ tag: 'interactive', attrs: { type: 'native_flow', v: '1' }, content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }] }] };
  } else if (message.listMessage) {
    return { tag: 'biz', attrs: {}, content: [{ tag: 'list', attrs: { v: '2', type: 'product_list' } }] };
  } else {
    return { tag: 'biz', attrs: {} };
  }
}

// -------------------- CONVERT TO INTERACTIVE --------------------
function convertToInteractiveMessage(content) {
  if (content.interactiveButtons && content.interactiveButtons.length > 0) {
    const interactiveMessage = {
      nativeFlowMessage: {
        buttons: content.interactiveButtons.map(btn => ({ name: btn.name || 'quick_reply', buttonParamsJson: btn.buttonParamsJson }))
      }
    };

    if (content.title || content.subtitle || content.image) {
      interactiveMessage.header = {};
      if (content.title || content.subtitle) interactiveMessage.header.title = content.title || content.subtitle || '';
      if (content.image) interactiveMessage.header.image = content.image;
    }
    if (content.text) interactiveMessage.body = { text: content.text };
    if (content.footer) interactiveMessage.footer = { text: content.footer };

    const newContent = { ...content };
    delete newContent.interactiveButtons;
    delete newContent.title;
    delete newContent.subtitle;
    delete newContent.text;
    delete newContent.footer;
    delete newContent.image;

    return { ...newContent, interactiveMessage };
  }
  return content;
}

// -------------------- SEND INTERACTIVE MESSAGE --------------------
async function sendInteractiveMessage(sock, jid, content, options = {}) {
  if (!sock) throw new InteractiveValidationError('Socket is required', { context: 'sendInteractiveMessage' });

  if (content && Array.isArray(content.interactiveButtons)) {
    const strict = validateSendInteractiveMessagePayload(content);
    if (!strict.valid) throw new InteractiveValidationError('Interactive authoring payload invalid', { context: 'sendInteractiveMessage.validateSendInteractiveMessagePayload', errors: strict.errors, warnings: strict.warnings, example: EXAMPLE_PAYLOADS.sendInteractiveMessage });
    if (strict.warnings.length) console.warn('sendInteractiveMessage warnings:', strict.warnings);
  }

  const convertedContent = convertToInteractiveMessage(content);
  const { errors: contentErrors, warnings: contentWarnings, valid: contentValid } = validateInteractiveMessageContent(convertedContent);
  if (!contentValid) throw new InteractiveValidationError('Converted interactive content invalid', { context: 'sendInteractiveMessage.validateInteractiveMessageContent', errors: contentErrors, warnings: contentWarnings, example: convertToInteractiveMessage(EXAMPLE_PAYLOADS.sendInteractiveMessage) });
  if (contentWarnings.length) console.warn('Interactive content warnings:', contentWarnings);

  let generateWAMessageFromContent, relayMessage, normalizeMessageContent, isJidGroup, generateMessageIDV2;
  const candidatePkgs = ['baileys', '@whiskeysockets/baileys', '@adiwajshing/baileys'];
  let loaded = false;
  for (const pkg of candidatePkgs) {
    if (loaded) break;
    try {
      const mod = require(pkg);
      generateWAMessageFromContent = mod.generateWAMessageFromContent || mod.Utils?.generateWAMessageFromContent;
      normalizeMessageContent = mod.normalizeMessageContent || mod.Utils?.normalizeMessageContent;
      isJidGroup = mod.isJidGroup || mod.WABinary?.isJidGroup;
      generateMessageIDV2 = mod.generateMessageIDV2 || mod.Utils?.generateMessageIDV2 || mod.generateMessageID || mod.Utils?.generateMessageID;
      relayMessage = sock.relayMessage;
      if (generateWAMessageFromContent && normalizeMessageContent && isJidGroup && relayMessage) loaded = true;
    } catch (_) {}
  }
  if (!loaded) throw new InteractiveValidationError('Missing baileys internals', { context: 'sendInteractiveMessage.dynamicImport', errors: ['generateWAMessageFromContent or normalizeMessageContent not found'], example: { install: 'npm i baileys', requireUsage: "const { generateWAMessageFromContent } = require('baileys')" } });

  const userJid = sock.authState?.creds?.me?.id || sock.user?.id;
  const fullMsg = generateWAMessageFromContent(jid, convertedContent, { logger: sock.logger, userJid, messageId: generateMessageIDV2(userJid), timestamp: new Date(), ...options });

  const normalizedContent = normalizeMessageContent(fullMsg.message);
  const buttonType = getButtonType(normalizedContent);
  let additionalNodes = [...(options.additionalNodes || [])];
  if (buttonType) {
    const buttonsNode = getButtonArgs(normalizedContent);
    additionalNodes.push(buttonsNode);
    if (!isJidGroup(jid)) additionalNodes.push({ tag: 'bot', attrs: { biz_bot: '1' } });
    console.log('Interactive send: ', { type: buttonType, nodes: additionalNodes.map(n => ({ tag: n.tag, attrs: n.attrs })), private: !isJidGroup(jid) });
  }

  await relayMessage(jid, fullMsg.message, { messageId: fullMsg.key.id, useCachedGroupMetadata: options.useCachedGroupMetadata, additionalAttributes: options.additionalAttributes || {}, statusJidList: options.statusJidList, additionalNodes });

  if (sock.config?.emitOwnEvents && !isJidGroup(jid)) {
    process.nextTick(() => { if (sock.processingMutex?.mutex && sock.upsertMessage) sock.processingMutex.mutex(() => sock.upsertMessage(fullMsg, 'append')); });
  }

  return fullMsg;
}

// -------------------- SEND BUTTONS BASIC --------------------
async function sendInteractiveButtonsBasic(sock, jid, data = {}, options = {}) {
  if (!sock) throw new InteractiveValidationError('Socket is required', { context: 'sendButtons' });

  const { text = '', footer = '', title, subtitle, buttons = [], image } = data;
  const strict = validateSendButtonsPayload({ text, buttons, title, subtitle, footer });
  if (!strict.valid) throw new InteractiveValidationError('Buttons payload invalid', { context: 'sendButtons.validateSendButtonsPayload', errors: strict.errors, warnings: strict.warnings, example: EXAMPLE_PAYLOADS.sendButtons });
  if (strict.warnings.length) console.warn('sendButtons warnings:', strict.warnings);

  const { errors, warnings, cleaned } = validateAuthoringButtons(buttons);
  if (errors.length) throw new InteractiveValidationError('Authoring button objects invalid', { context: 'sendButtons.validateAuthoringButtons', errors, warnings, example: EXAMPLE_PAYLOADS.sendButtons.buttons });
  if (warnings.length) console.warn('Button validation warnings:', warnings);

  const interactiveButtons = buildInteractiveButtons(cleaned);
  const payload = { text, footer, interactiveButtons };
  if (title) payload.title = title;
  if (subtitle) payload.subtitle = subtitle;
  if (image) payload.image = image;

  return sendInteractiveMessage(sock, jid, payload, options);
}

// -------------------- EXPORTS --------------------
module.exports = {
  sendButtons: sendInteractiveButtonsBasic,
  sendInteractiveMessage,
  getButtonType,
  getButtonArgs,
  InteractiveValidationError,
  validateAuthoringButtons,
  validateInteractiveMessageContent,
  validateSendButtonsPayload,
  validateSendInteractiveMessagePayload
};
