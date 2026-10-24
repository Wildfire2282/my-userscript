import * as UserscriptUI from '../src/index';

declare global {
  interface Window {
    UserscriptUI: typeof UserscriptUI;
  }
}

window.UserscriptUI = UserscriptUI;
