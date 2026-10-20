/**
 * Folder consume refs from chat use the local-folder binding id (`lfb:…`).
 * Source descriptors and document links use the descriptor id (`src:…`).
 * Resolve both aliases to one sourceDescriptorId before listing files.
 */
import { getLocalFolderBinding, listLocalFolderBindings } from "./local-folder-binding-store.js";
import { listKnowledgeSourceBindings } from "./source-binding-store.js";

export type LocalFolderConsumeSource = {
  bindingId: string;
  sourceDescriptorId: string;
  knowledgeBaseId: string;
};

export function resolveLocalFolderConsumeSource(params: {
  knowledgeBaseId: string;
  folderId: string;
  bindingStorePath?: string;
  sourceBindingStorePath?: string;
}): LocalFolderConsumeSource | null {
  const knowledgeBaseId = params.knowledgeBaseId.trim();
  const folderId = params.folderId.trim();
  if (!knowledgeBaseId || !folderId) {
    return null;
  }

  const byBinding = getLocalFolderBinding(folderId, params.bindingStorePath);
  if (byBinding && byBinding.knowledgeBaseId === knowledgeBaseId) {
    return {
      bindingId: byBinding.bindingId,
      sourceDescriptorId: byBinding.sourceDescriptorId,
      knowledgeBaseId: byBinding.knowledgeBaseId,
    };
  }

  const descriptors = listKnowledgeSourceBindings(
    { knowledgeBaseId },
    params.sourceBindingStorePath,
  ).filter((item) => item.kind === "localFolder");
  const byDescriptor = descriptors.find((item) => item.id === folderId);
  if (byDescriptor) {
    const binding =
      listLocalFolderBindings(
        { knowledgeBaseId, sourceDescriptorId: byDescriptor.id },
        params.bindingStorePath,
      )[0] ?? null;
    return {
      bindingId: binding?.bindingId || byDescriptor.metadata?.bindingId || byDescriptor.id,
      sourceDescriptorId: byDescriptor.id,
      knowledgeBaseId,
    };
  }

  const byMetadata = descriptors.find((item) => item.metadata?.bindingId === folderId);
  if (byMetadata) {
    return {
      bindingId: folderId,
      sourceDescriptorId: byMetadata.id,
      knowledgeBaseId,
    };
  }

  return null;
}
