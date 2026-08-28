'use strict';

// Ground-truth regression coverage for a real dogfood report: a Coder task calls attach_image
// several times in a row (UI verification screenshots), the durable task completes, Dispatch's
// completion relay (notifySupervisorOfCoderCompletion -> summarizeCoderCompletion ->
// notifyOrionConversation) posts the result into the Dispatch conversation, and the phone later
// asks readChatImageForPhone for each image path.
//
// This exact end-to-end path had ZERO prior test coverage. Every earlier phone-image test
// constructed a message with `images` already attached by hand, bypassing the real completion
// relay entirely. This test goes through the real onOrchestrationTaskFinalized entry point, uses
// the real orion-artifact:// URI shape that writeScreenshotBuffer actually returns (not a bare
// relative path), and reads images back through the REAL lib/ipc-file-tools.js implementation
// (including its conversation-ownership check), not a mock that always succeeds.
const test = require('tape');
const { loadRenderer } = require('./helpers/renderer-harness');
const fileTools = require('../lib/ipc-file-tools');

const DISPATCH_ID = 'dispatch-owner-multi-image';
const CODER_ID = 'coder-worker-multi-image';
const TASK_ID = 'task-completed-multi-image';

function fourImages() {
  return [1, 2, 3, 4].map(n => {
    const written = fileTools.writeConversationArtifactBuffer(CODER_ID, `screenshot-${n}.png`, Buffer.from(`fake-png-${n}`));
    return {
      path: written.artifactRef,
      workspacePath: 'C:\\isolated\\coder-workspace',
      sourceConversationId: CODER_ID,
      mimeType: 'image/png',
      alt: 'Orion screenshot',
      caption: `Screenshot ${n}`
    };
  });
}

function completedTask(images) {
  return {
    taskId: TASK_ID,
    title: 'Re-capture UI verification screenshots to artifacts/',
    status: 'completed',
    origin: { conversationId: DISPATCH_ID, sessionId: '', messageId: '' },
    rootOriginConversationId: DISPATCH_ID,
    target: { conversationId: CODER_ID, sessionId: '', messageId: '', mode: 'coder' },
    result: {
      summary: 'Recaptured all 4 verification screenshots.',
      changedFiles: [],
      verification: [],
      images
    },
    completedAt: 1700000000000,
    updatedAt: 1700000000000
  };
}

function dispatchConversation() {
  return {
    id: DISPATCH_ID,
    title: 'Push all updates for Orion to GitHub',
    mode: 'orion',
    messages: [],
    tasks: [],
    launchedCoderConvId: CODER_ID,
    launchedCoderTaskId: TASK_ID,
    launchedCoderTaskTitle: 'Re-capture UI verification screenshots to artifacts/',
    launchedCoderTaskStart: 1699999000000
  };
}

function coderConversation() {
  return { id: CODER_ID, title: 'Re-capture UI verification screenshots to artifacts/', mode: 'coder', messages: [], tasks: [] };
}

function cleanupArtifacts() {
  // Best-effort: some sandboxes cannot unlink files they don't own. Harmless either way -- this
  // is disposable test output under the gitignored artifacts/ directory.
  try { fileTools.deleteConversationArtifacts(CODER_ID); } catch (_) { /* ignore */ }
}

test('4 attach_image screenshots from a completed Coder task survive the real Dispatch completion relay', async t => {
  const images = fourImages();
  const task = completedTask(images);
  const { win, read } = loadRenderer({
    t,
    set: {
      conversations: [dispatchConversation(), coderConversation()],
      activeConversationId: DISPATCH_ID
    },
    api: {
      getOrchestrationTask: async () => ({ success: true, task }),
      // The real implementation, not a stub that always succeeds -- this is what actually decides
      // success/failure in production, ownership check included.
      readWorkspaceFileBase64: async (workspacePath, relativePath, conversationId) => {
        try {
          return fileTools.readWorkspaceFileBase64(workspacePath, relativePath, conversationId);
        } catch (e) {
          return { success: false, error: e.message };
        }
      }
    }
  });

  await win.onOrchestrationTaskFinalized(TASK_ID, CODER_ID, 'completed');

  const conversations = read('conversations') || [];
  const dispatchConv = conversations.find(c => c.id === DISPATCH_ID);
  const completionMsg = (dispatchConv.messages || []).find(m => m.source === 'supervisor-completion');

  t.ok(completionMsg, 'a supervisor-completion message was posted to Dispatch');
  if (!completionMsg) { cleanupArtifacts(); t.end(); return; }

  t.ok(Array.isArray(completionMsg.images), 'the completion message carries an images array');
  t.equal(completionMsg.images.length, 4, 'all 4 attached screenshots ride along on the completion message');

  for (const image of completionMsg.images) {
    const result = await win.readChatImageForPhone({ conversationId: DISPATCH_ID, path: image.path });
    t.equal(result.success, true, `readChatImageForPhone resolves ${image.path}: ${result.error || 'ok'}`);
  }

  cleanupArtifacts();
  t.end();
});

test('the phone cannot read a relayed image using the wrong conversation id', async t => {
  // Locks in the ownership boundary readWorkspaceFileBase64 enforces, so a future change cannot
  // silently widen it while the happy-path test above still passes.
  const images = fourImages();
  const badPath = images[0].path;
  let threw = false;
  try {
    fileTools.readWorkspaceFileBase64('C:\\isolated\\coder-workspace', badPath, 'a-completely-different-conversation');
  } catch (e) {
    threw = true;
    t.match(e.message, /different conversation/i, 'the artifact ownership check rejects a mismatched conversation id');
  }
  t.ok(threw, 'reading a real artifact with the wrong owning conversation id fails, not silently succeeds');
  cleanupArtifacts();
  t.end();
});
