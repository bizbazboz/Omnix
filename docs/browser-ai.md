# Browser AI

Open **AI** and select **Load local model**. Omnix downloads a pinned revision of
SmolLM2-135M-Instruct-ONNX (quantized, approximately 140 MB) from Hugging Face.
The ONNX runtime is served by Omnix. Generation runs on the browser CPU in a
separate Web Worker; no hosted inference service, API key or GPU is required.
Use a current browser through localhost or the HTTPS tunnel. Available browser
memory and CPU determine speed; background tabs may be throttled.

Choose notes, calendar and/or projects, a calendar range, then ask a question.
Omnix retrieves bounded extracts from your own account's cached data. It does not
send them to Hugging Face: model downloads are public GET requests, while prompts
and inference stay on your device. This is read-only; the model cannot send mail,
edit notes or operate lights. Embedded workspace references are not automatically
expanded into additional private data.

Source links appear below each answer. A small model can misunderstand or invent
details; verify answers against those links. Notes retrieval covers the most
recent 250 active pages, projects the latest 200 issues, and the selected upcoming
calendar window. Retrieval is lexical and uses at most eight extracts; it is not
an exhaustive semantic index. Today, tomorrow and this-week calendar requests
respect your saved timezone.

The conversation lives only in the tab. Model files use the browser cache when
available. **Context and storage → Clear conversation** removes tab history;
**Remove downloaded model** also clears this model's dedicated cache. Stop unloads
the active worker and leaves completed text visible. Sign-out/navigation destroys
the worker; no conversation is written to the Omnix database.

Model: [pinned ONNX conversion](https://huggingface.co/onnx-community/SmolLM2-135M-Instruct-ONNX/tree/b8a5c0f183b78c55955a5364f610c36668b5e681).
Runtime: [Transformers.js](https://huggingface.co/docs/transformers.js).
