import type { EnterpriseDataStore } from "../../enterprise-data/types.js";
import type { KnowledgeSourceContext } from "../sources/types.js";
import type { KnowledgeObject } from "../types.js";
import { loadEnterpriseKnowledgeFeed } from "./enterprise-feed-adapter.js";
import type { KnowledgeFeedBundle, KnowledgeFeedItem } from "./types.js";

export function loadKnowledgeFeedBundle(params: {
  store: EnterpriseDataStore;
  context: KnowledgeSourceContext;
}): KnowledgeFeedBundle & {
  enterpriseAccessible: KnowledgeObject[];
  enterpriseRestricted: KnowledgeObject[];
  dataObjects: KnowledgeObject[];
} {
  // Universe consumption is persisted EnterpriseKnowledgeObjectFeedItem only.
  // Capability catalog cards are loaded separately and must not invent feed items.
  const enterprise = loadEnterpriseKnowledgeFeed(params);
  return {
    feedItems: enterprise.feedItems,
    objects: [...enterprise.accessible],
    enterpriseAccessible: enterprise.accessible,
    enterpriseRestricted: enterprise.restricted,
    dataObjects: [],
  };
}

export function summarizeKnowledgeFeed(params: {
  enterpriseAccessible: KnowledgeObject[];
  enterpriseRestricted: KnowledgeObject[];
  dataObjects: KnowledgeObject[];
  feedItems: KnowledgeFeedItem[];
}): {
  enterpriseAccessible: number;
  enterpriseRestricted: number;
  dataCapabilityCount: number;
  feedItemCount: number;
} {
  return {
    enterpriseAccessible: params.enterpriseAccessible.length,
    enterpriseRestricted: params.enterpriseRestricted.length,
    dataCapabilityCount: params.dataObjects.length,
    feedItemCount: params.feedItems.length,
  };
}
