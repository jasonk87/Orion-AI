'use strict';

const { parentPort } = require('worker_threads');
const { inspectCodeContext, readMultipleRanges } = require('./context-retrieval');
const { semanticSearch } = require('./semantic-search');
const {
  getWorkspaceIndexService,
  resetWorkspaceIndexServices
} = require('./workspace-index-service');

if (!parentPort) {
  throw new Error('workspace-index-worker must run inside a worker thread.');
}

async function execute(operation, payload = {}) {
  const workspacePath = String(payload.workspacePath || '');
  if (!workspacePath) throw new Error('Missing workspace path.');

  switch (operation) {
    case 'inspectCodeContext':
      return inspectCodeContext(workspacePath, payload);
    case 'readMultipleRanges':
      return readMultipleRanges(workspacePath, payload.files, payload.options || {});
    case 'assignContextPackets':
      return getWorkspaceIndexService(workspacePath).assignContextPackets(payload.packetIds, payload);
    case 'hydrateContextPackets':
      return getWorkspaceIndexService(workspacePath).hydrateContextPackets(payload.packetIds, payload);
    case 'getFileSymbols':
      return {
        success: true,
        symbols: getWorkspaceIndexService(workspacePath).getFileSymbols(payload.relativePath)
      };
    case 'getSymbolIndex':
      return {
        success: true,
        index: getWorkspaceIndexService(workspacePath).getSymbolIndex()
      };
    case 'findReferences':
      return getWorkspaceIndexService(workspacePath).findReferences(payload.symbolName, payload.targetPath);
    case 'recordFileRead':
      return {
        success: true,
        ...getWorkspaceIndexService(workspacePath).recordFileRead(payload.relativePath)
      };
    case 'saveFileDigest':
      return {
        success: true,
        ...getWorkspaceIndexService(workspacePath).saveFileDigest(payload.relativePath, payload.digest)
      };
    case 'getKnowledgeBrief':
      return {
        success: true,
        ...getWorkspaceIndexService(workspacePath).buildKnowledgeBrief({ maxDigests: payload.maxDigests })
      };
    case 'semanticSearch':
      return {
        success: true,
        results: await semanticSearch(payload.query, workspacePath, payload.config || {}, payload.topK)
      };
    case 'telemetry': {
      const service = getWorkspaceIndexService(workspacePath);
      service.ensureInitialReconciled();
      return { success: true, telemetry: service.getTelemetry(), revision: service.revision };
    }
    default:
      throw new Error(`Unknown workspace intelligence operation: ${operation}`);
  }
}

parentPort.on('message', async message => {
  const id = message && message.id;
  if (!id) return;
  try {
    const result = await execute(message.operation, message.payload || {});
    parentPort.postMessage({ id, success: true, result });
  } catch (error) {
    parentPort.postMessage({
      id,
      success: false,
      error: error && error.message ? error.message : String(error),
      code: error && error.code ? error.code : ''
    });
  }
});

parentPort.on('close', () => {
  resetWorkspaceIndexServices();
});
