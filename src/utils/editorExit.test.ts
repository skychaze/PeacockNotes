import { shouldAutoSaveBeforeHome } from './editorExit';

const assert = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };

assert(!shouldAutoSaveBeforeHome(false, false), 'an empty editor should not create a note');
assert(shouldAutoSaveBeforeHome(true, false), 'a changed draft must save before Home');
assert(shouldAutoSaveBeforeHome(false, true), 'an active recording must save before Home');
