// Entry point. The app follows model–view–controller:
//   model/       data, rules, persistence and file formats (no DOM, no dialogs)
//   view/        rendering and DOM events; reads the model, sends user actions to controllers
//   controller/  handles user actions: asks and confirms, updates the model, gives feedback
// Every committed change to the model notifies subscribers, which re-render the whole view.

import './view/style.css';
import { commit, onSaveError, project, subscribe } from './model/state';
import { initApp, renderApp } from './view/app';
import { notify } from './view/feedback';
import { openStartDialog } from './view/startDialog';

onSaveError(() =>
  notify('Saving to local storage failed (the browser storage is probably full). Export your project now so you do not lose work.'),
);
initApp();
subscribe(renderApp);
commit();
// First use: ask for the coder's name, and whether to start a new project or open one.
if (!project.coderName) openStartDialog({ firstUse: true });
