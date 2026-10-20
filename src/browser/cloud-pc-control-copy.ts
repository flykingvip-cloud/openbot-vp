/**
 * Copy for a cloud PC whose picture is up (noVNC) while CDP control is not.
 *
 * The desktop and the control bridge are different pipes. A 15s client abort
 * used to be reported as "Can't reach the browser control service", which the
 * chat renders as a red banner and the model retries. This sentence is the
 * one line the model should say, and the cue to stop calling the browser tool.
 */
export const CLOUD_PC_CONTROL_STARTING_SENTENCE =
  "云电脑还在启动，画面可以先看。这一轮不要再调用浏览器。";

export const CLOUD_PC_CONTROL_STARTING_TOOL_ERROR = [
  CLOUD_PC_CONTROL_STARTING_SENTENCE,
  "This is a startup wait, not a platform fault.",
  "Say that sentence to the user.",
  "Do not call the browser tool again this turn.",
  "Do not quote an English timeout.",
].join(" ");
