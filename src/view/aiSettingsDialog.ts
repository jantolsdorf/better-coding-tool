// The AI settings: an OpenAI-compatible API (base URL, key, model and options), with a
// connection test and the server's model list. Saved in this browser only (see aiSettings.ts).

import './aiCode.css';
import { listModels, testConnection } from '../controller/aiCoding';
import { ANSWER_FORMATS, DEFAULT_PROMPTS, type AiPrompts } from '../model/aiCoding';
import { loadAiSettings, saveAiSettings, type AiSettings } from '../model/aiSettings';
import { h } from './dom';
import { currentDocument } from './windows';

/** Opens the settings; resolves with the saved settings, or null if closed without saving. */
export function openAiSettings(): Promise<AiSettings | null> {
  return new Promise((resolve) => {
    const s = loadAiSettings();
    let saved: AiSettings | null = null;
    const dlg = h('dialog', { class: 'modal ai-settings' });
    dlg.addEventListener('close', () => {
      dlg.remove();
      resolve(saved);
    });

    const field = (attrs: Record<string, unknown>) => h('input', { class: 'field', spellcheck: 'false', autocomplete: 'off', ...attrs });
    const baseUrl = field({ type: 'url', value: s.baseUrl, placeholder: 'https://api.openai.com/v1' });
    const apiKey = field({ type: 'password', value: s.apiKey, placeholder: 'sk-…  (may be empty for a local server)' });
    const showKey = h('button', { type: 'button', class: 'btn small', title: 'Show or hide the key' }, 'Show');
    showKey.addEventListener('click', () => {
      apiKey.type = apiKey.type === 'password' ? 'text' : 'password';
      showKey.textContent = apiKey.type === 'password' ? 'Show' : 'Hide';
    });
    const remember = h('input', { type: 'checkbox', checked: s.rememberKey });
    const model = field({ type: 'text', value: s.model, placeholder: 'Model name, e.g. as listed by your provider', list: 'ai-models' });
    const models = h('datalist', { id: 'ai-models' });
    const temperature = field({ type: 'number', min: 0, max: 2, step: 0.1, value: String(s.temperature), class: 'field ai-num' });
    const batchChars = field({ type: 'number', min: 500, max: 100000, step: 500, value: String(s.batchChars), class: 'field ai-num' });
    const jsonMode = h('input', { type: 'checkbox', checked: s.jsonMode });
    const status = h('p', { class: 'ai-status muted' });

    // ---- the prompt ----
    const promptField = (key: keyof AiPrompts, rows: number) => {
      const area = h('textarea', { class: 'field ai-prompt-text', rows, spellcheck: 'false', placeholder: DEFAULT_PROMPTS[key] });
      area.value = s.prompts[key];
      area.addEventListener('input', markEdited);
      return area;
    };
    const promptFields: Record<keyof AiPrompts, HTMLTextAreaElement> = {
      system: promptField('system', 7),
      paragraphTask: promptField('paragraphTask', 2),
      documentTask: promptField('documentTask', 4),
    };
    const promptSummary = h('summary', {}, 'Prompt');
    const resetPrompts = h('button', { type: 'button', class: 'btn small', title: 'Put back the default wording' }, 'Reset to default');
    function markEdited() {
      const edited = (Object.keys(promptFields) as (keyof AiPrompts)[]).some((k) => promptFields[k].value.trim() !== DEFAULT_PROMPTS[k]);
      promptSummary.textContent = edited ? 'Prompt (edited)' : 'Prompt';
      resetPrompts.disabled = !edited;
    }
    resetPrompts.addEventListener('click', () => {
      for (const k of Object.keys(promptFields) as (keyof AiPrompts)[]) promptFields[k].value = DEFAULT_PROMPTS[k];
      markEdited();
    });
    markEdited();
    const fixedFormat = (text: string) =>
      h('p', { class: 'ai-format' }, h('span', { class: 'muted' }, 'Always added after it (the tool reads the answer in this form): '), h('code', {}, text));
    const promptSection = h(
      'details',
      { class: 'ai-prompt' },
      promptSummary,
      h(
        'p',
        { class: 'muted ai-note' },
        'Each request sends two messages: the instructions (as the system message), and a message with the codebook ' +
          '(each chosen code as C1, C2…: its path, definition and, if shared, examples), then the task with the answer format, then the text.',
      ),
      h('label', { class: 'label' }, 'Instructions (system message)'),
      promptFields.system,
      h('label', { class: 'label' }, 'Task when sending paragraphs'),
      promptFields.paragraphTask,
      fixedFormat(ANSWER_FORMATS.paragraph),
      h('label', { class: 'label' }, 'Task when sending whole documents'),
      promptFields.documentTask,
      fixedFormat(ANSWER_FORMATS.document),
      h('div', { class: 'ai-prompt-actions' }, resetPrompts),
    );

    const current = (): AiSettings => ({
      baseUrl: baseUrl.value.trim(),
      apiKey: apiKey.value.trim(),
      rememberKey: remember.checked,
      model: model.value.trim(),
      temperature: Math.min(2, Math.max(0, Number(temperature.value) || 0)),
      jsonMode: jsonMode.checked,
      batchChars: Math.min(100000, Math.max(500, Math.round(Number(batchChars.value) || 6000))),
      // An emptied field means the default.
      prompts: {
        system: promptFields.system.value.trim() || DEFAULT_PROMPTS.system,
        paragraphTask: promptFields.paragraphTask.value.trim() || DEFAULT_PROMPTS.paragraphTask,
        documentTask: promptFields.documentTask.value.trim() || DEFAULT_PROMPTS.documentTask,
      },
    });
    const say = (text: string, kind: 'muted' | 'ok' | 'error') => {
      status.textContent = text;
      status.className = `ai-status ${kind}`;
    };

    const loadBtn = h('button', { type: 'button', class: 'btn small', title: 'Ask the server which models it offers' }, 'Load models');
    loadBtn.addEventListener('click', async () => {
      say('Loading models…', 'muted');
      try {
        const ids = await listModels(current());
        models.replaceChildren(...ids.map((id) => h('option', { value: id })));
        say(ids.length ? `${ids.length} models found: pick one in the model field.` : 'The server lists no models; type the name.', 'ok');
      } catch (e) {
        say((e as Error).message, 'error');
      }
    });
    const testBtn = h('button', { type: 'button', class: 'btn' }, 'Test connection');
    testBtn.addEventListener('click', async () => {
      const cur = current();
      if (!cur.model) return say('Enter a model first.', 'error');
      say('Sending a short test request…', 'muted');
      testBtn.disabled = true;
      try {
        await testConnection(cur);
        say(`Connected: ${cur.model} answers.`, 'ok');
      } catch (e) {
        say((e as Error).message, 'error');
      } finally {
        testBtn.disabled = false;
      }
    });
    const save = () => {
      saved = current();
      saveAiSettings(saved);
      dlg.close();
    };

    dlg.append(
      h(
        'div',
        { class: 'modal-inner' },
        h('div', { class: 'modal-head' }, h('strong', { class: 'grow' }, 'AI settings')),
        h(
          'div',
          { class: 'modal-body' },
          h(
            'p',
            { class: 'muted ai-intro' },
            'For AI coding, any API compatible with OpenAI’s chat completions works: OpenAI itself, or a server on your own computer or network ' +
              '(e.g. Ollama: http://localhost:11434/v1, LM Studio: http://localhost:1234/v1), which keeps the text local.',
          ),
          h('label', { class: 'label' }, 'Base URL'),
          baseUrl,
          h('label', { class: 'label' }, 'API key'),
          h('div', { class: 'row' }, apiKey, showKey),
          h('label', { class: 'ai-check' }, remember, ' Remember the key in this browser (otherwise it is forgotten when this tab closes)'),
          h('p', { class: 'muted ai-note' }, 'The key and these settings are never part of an exported project.'),
          h('label', { class: 'label' }, 'Model'),
          h('div', { class: 'row' }, model, loadBtn),
          models,
          h(
            'div',
            { class: 'ai-options' },
            h('label', {}, 'Temperature ', temperature),
            h('label', { title: 'Paragraphs are sent together up to this size; whole documents are cut into pieces of this size' }, 'Characters per request ', batchChars),
            h('label', { title: 'Ask the server for a JSON answer; turn off if the server does not support it' }, jsonMode, ' JSON mode'),
          ),
          promptSection,
          status,
        ),
        h(
          'div',
          { class: 'modal-foot' },
          testBtn,
          h('span', { class: 'grow' }),
          h('button', { type: 'button', class: 'btn', onClick: () => dlg.close() }, 'Cancel'),
          h('button', { type: 'button', class: 'btn primary', onClick: save }, 'Save settings'),
        ),
      ),
    );
    currentDocument().body.append(dlg);
    dlg.showModal();
    (s.baseUrl ? (s.model ? apiKey : model) : baseUrl).focus();
  });
}
