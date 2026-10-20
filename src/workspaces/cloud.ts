import { createHash, createHmac } from "node:crypto";
import type { CloudWorkspaceProvider } from "./store.js";

export type CloudWorkspaceInput = {
  provider: CloudWorkspaceProvider;
  region?: string;
  bucket?: string;
  rootPrefix?: string;
  endpoint?: string;
  accountName?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  path?: string;
};

export type CloudWorkspaceGeneratedConfig = {
  provider: CloudWorkspaceProvider;
  endpoint: string;
  bucket: string;
  rootPrefix: string;
  region?: string;
  accountName?: string;
};

export type CloudWorkspaceBrowseResult = {
  bucket: string;
  currentPath: string;
  parentPath?: string;
  directories: Array<{ name: string; path: string }>;
};

export type CloudProviderConnectionResult = {
  ok: true;
  capabilities: {
    canRead: boolean;
    canWrite: boolean;
  };
};

export interface CloudProviderAdapter {
  readonly provider: CloudWorkspaceProvider;
  generateConfig(input: CloudWorkspaceInput): CloudWorkspaceGeneratedConfig;
  testConnection(input: CloudWorkspaceInput): Promise<CloudProviderConnectionResult>;
  browse(input: CloudWorkspaceInput): Promise<CloudWorkspaceBrowseResult>;
}

function normalizeRootPrefix(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

function requireCloudField(value: string | undefined, label: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${label} 不能为空。`);
  }
  return trimmed;
}

function mapCloudHttpError(status: number) {
  if (status === 403 || status === 401) {
    throw new Error("无法连接云服务，请检查凭据。");
  }
  if (status === 404) {
    throw new Error("未找到该存储空间。");
  }
  throw new Error("无法连接云端空间，请稍后重试。");
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(
  key: Buffer | string,
  value: string,
  encoding: "hex" | "base64" | undefined = undefined,
) {
  const digest = createHmac("sha256", key).update(value).digest();
  if (!encoding) {
    return digest;
  }
  return digest.toString(encoding);
}

function hmacSha1Base64(key: string, value: string) {
  return createHmac("sha1", key).update(value).digest("base64");
}

function hmacSha256Base64(key: string, value: string) {
  return createHmac("sha256", Buffer.from(key, "base64")).update(value).digest("base64");
}

function toAmzDate(date: Date) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

async function signedFetchAws(params: {
  method: "GET" | "HEAD";
  endpoint: URL;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  pathname: string;
  query?: Record<string, string>;
}) {
  const date = new Date();
  const { amzDate, dateStamp } = toAmzDate(date);
  const url = new URL(params.endpoint.toString());
  url.pathname = params.pathname;
  const queryEntries = Object.entries(params.query ?? {}).toSorted(([a], [b]) =>
    a.localeCompare(b),
  );
  for (const [key, value] of queryEntries) {
    url.searchParams.set(key, value);
  }
  const canonicalQuery = queryEntries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${sha256Hex("")}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    params.method,
    url.pathname || "/",
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    sha256Hex(""),
  ].join("\n");
  const credentialScope = `${dateStamp}/${params.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const kDate = hmac(`AWS4${params.secretAccessKey}`, dateStamp) as Buffer;
  const kRegion = hmac(kDate, params.region) as Buffer;
  const kService = hmac(kRegion, "s3") as Buffer;
  const signingKey = hmac(kService, "aws4_request") as Buffer;
  const signature = hmac(signingKey, stringToSign, "hex") as string;
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return await fetch(url, {
    method: params.method,
    headers: {
      Authorization: authorization,
      "x-amz-content-sha256": sha256Hex(""),
      "x-amz-date": amzDate,
    },
  });
}

async function signedFetchAliyun(params: {
  method: "GET" | "HEAD";
  endpoint: URL;
  accessKeyId: string;
  secretAccessKey: string;
  bucket?: string;
  query?: Record<string, string>;
}) {
  const date = new Date().toUTCString();
  const url = new URL(params.endpoint.toString());
  if (params.bucket) {
    url.hostname = `${params.bucket}.${url.hostname}`;
  }
  const queryEntries = Object.entries(params.query ?? {}).toSorted(([a], [b]) =>
    a.localeCompare(b),
  );
  for (const [key, value] of queryEntries) {
    url.searchParams.set(key, value);
  }
  const canonicalResourceBase = params.bucket ? `/${params.bucket}/` : "/";
  const canonicalResourceQuery = queryEntries.length
    ? `?${queryEntries.map(([key, value]) => `${key}=${value}`).join("&")}`
    : "";
  const stringToSign = [
    params.method,
    "",
    "",
    date,
    `${canonicalResourceBase}${canonicalResourceQuery}`,
  ].join("\n");
  const signature = hmacSha1Base64(params.secretAccessKey, stringToSign);
  return await fetch(url, {
    method: params.method,
    headers: {
      Date: date,
      Authorization: `OSS ${params.accessKeyId}:${signature}`,
    },
  });
}

async function signedFetchObs(params: {
  method: "GET" | "HEAD";
  endpoint: URL;
  accessKeyId: string;
  secretAccessKey: string;
  bucket?: string;
  query?: Record<string, string>;
}) {
  const date = new Date().toUTCString();
  const url = new URL(params.endpoint.toString());
  if (params.bucket) {
    url.hostname = `${params.bucket}.${url.hostname}`;
  }
  const queryEntries = Object.entries(params.query ?? {}).toSorted(([a], [b]) =>
    a.localeCompare(b),
  );
  for (const [key, value] of queryEntries) {
    url.searchParams.set(key, value);
  }
  const canonicalResourceBase = params.bucket ? `/${params.bucket}/` : "/";
  const canonicalResourceQuery = queryEntries.length
    ? `?${queryEntries.map(([key, value]) => `${key}=${value}`).join("&")}`
    : "";
  const stringToSign = [
    params.method,
    "",
    "",
    date,
    `${canonicalResourceBase}${canonicalResourceQuery}`,
  ].join("\n");
  const signature = hmacSha1Base64(params.secretAccessKey, stringToSign);
  return await fetch(url, {
    method: params.method,
    headers: {
      Date: date,
      Authorization: `OBS ${params.accessKeyId}:${signature}`,
    },
  });
}

function buildAzureCanonicalizedResource(
  accountName: string,
  pathname: string,
  query: Record<string, string>,
) {
  const queryEntries = Object.entries(query).toSorted(([a], [b]) => a.localeCompare(b));
  const resourceLines = queryEntries.map(
    ([key, value]) => `\n${key.toLowerCase()}:${decodeURIComponent(value)}`,
  );
  return `/${accountName}${pathname}${resourceLines.join("")}`;
}

async function signedFetchAzure(params: {
  method: "GET" | "HEAD";
  endpoint: URL;
  accountName: string;
  secretAccessKey: string;
  pathname: string;
  query?: Record<string, string>;
}) {
  const date = new Date().toUTCString();
  const version = "2023-11-03";
  const url = new URL(params.endpoint.toString());
  url.pathname = params.pathname;
  const queryEntries = Object.entries(params.query ?? {}).toSorted(([a], [b]) =>
    a.localeCompare(b),
  );
  for (const [key, value] of queryEntries) {
    url.searchParams.set(key, value);
  }
  const canonicalizedHeaders = `x-ms-date:${date}\nx-ms-version:${version}\n`;
  const canonicalizedResource = buildAzureCanonicalizedResource(
    params.accountName,
    url.pathname,
    Object.fromEntries(queryEntries),
  );
  const stringToSign = [
    params.method,
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    canonicalizedHeaders + canonicalizedResource,
  ].join("\n");
  const signature = hmacSha256Base64(params.secretAccessKey, stringToSign);
  return await fetch(url, {
    method: params.method,
    headers: {
      Authorization: `SharedKey ${params.accountName}:${signature}`,
      "x-ms-date": date,
      "x-ms-version": version,
    },
  });
}

function decodeXmlTagList(xml: string, tagName: string) {
  const matches = [...xml.matchAll(new RegExp(`<${tagName}>([^<]+)</${tagName}>`, "g"))];
  return matches.map((entry) => entry[1] ?? "").filter(Boolean);
}

function decodeAzureBlobPrefixes(xml: string) {
  const matches = [...xml.matchAll(/<BlobPrefix>\s*<Name>([^<]+)<\/Name>\s*<\/BlobPrefix>/g)];
  return matches.map((entry) => entry[1] ?? "").filter(Boolean);
}

function trimPrefixPath(input: string | undefined, rootPrefix: string) {
  const normalized = input?.trim() ?? "";
  if (!normalized) {
    return rootPrefix;
  }
  const withSlash = normalized.endsWith("/") ? normalized : `${normalized}/`;
  if (withSlash.startsWith(rootPrefix)) {
    return withSlash;
  }
  return `${rootPrefix}${withSlash}`;
}

const awsS3Adapter: CloudProviderAdapter = {
  provider: "aws-s3",
  generateConfig(input) {
    const region = requireCloudField(input.region, "Region");
    return {
      provider: "aws-s3",
      region,
      endpoint:
        region === "us-east-1" ? "https://s3.amazonaws.com" : `https://s3.${region}.amazonaws.com`,
      bucket: requireCloudField(input.bucket, "Bucket"),
      rootPrefix: normalizeRootPrefix(input.rootPrefix),
    };
  },
  async testConnection(input) {
    const config = awsS3Adapter.generateConfig(input);
    try {
      const response = await signedFetchAws({
        method: "HEAD",
        endpoint: new URL(config.endpoint),
        region: config.region ?? "us-east-1",
        accessKeyId: requireCloudField(input.accessKeyId, "AccessKey ID"),
        secretAccessKey: requireCloudField(input.secretAccessKey, "AccessKey Secret"),
        pathname: `/${config.bucket}`,
      });
      if (!response.ok) {
        mapCloudHttpError(response.status);
      }
      return { ok: true, capabilities: { canRead: true, canWrite: true } };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error("无法连接云端空间，请稍后重试。", { cause: error });
    }
  },
  async browse(input) {
    const config = awsS3Adapter.generateConfig(input);
    const prefix = trimPrefixPath(input.path, config.rootPrefix);
    const response = await signedFetchAws({
      method: "GET",
      endpoint: new URL(config.endpoint),
      region: config.region ?? "us-east-1",
      accessKeyId: requireCloudField(input.accessKeyId, "AccessKey ID"),
      secretAccessKey: requireCloudField(input.secretAccessKey, "AccessKey Secret"),
      pathname: `/${config.bucket}`,
      query: {
        "list-type": "2",
        delimiter: "/",
        prefix,
      },
    });
    if (!response.ok) {
      mapCloudHttpError(response.status);
    }
    const xml = await response.text();
    const directories = decodeXmlTagList(xml, "Prefix").map((entry) => ({
      name: entry.replace(prefix, "").replace(/\/$/, "") || entry.replace(/\/$/, ""),
      path: entry,
    }));
    const trimmedPrefix = prefix.replace(/\/$/, "");
    const parentPath =
      trimmedPrefix && trimmedPrefix.includes("/")
        ? trimmedPrefix.slice(0, trimmedPrefix.lastIndexOf("/") + 1)
        : config.rootPrefix || undefined;
    return {
      bucket: config.bucket,
      currentPath: prefix,
      ...(parentPath && parentPath !== prefix ? { parentPath } : {}),
      directories,
    };
  },
};

const s3CompatibleAdapter: CloudProviderAdapter = {
  provider: "s3-compatible",
  generateConfig(input) {
    const endpoint = requireCloudField(input.endpoint, "Endpoint");
    return {
      provider: "s3-compatible",
      endpoint,
      bucket: requireCloudField(input.bucket, "Bucket"),
      rootPrefix: normalizeRootPrefix(input.rootPrefix),
      ...(input.region?.trim() ? { region: input.region.trim() } : {}),
    };
  },
  async testConnection(input) {
    const config = s3CompatibleAdapter.generateConfig(input);
    const region = input.region?.trim() || "us-east-1";
    const response = await signedFetchAws({
      method: "HEAD",
      endpoint: new URL(config.endpoint),
      region,
      accessKeyId: requireCloudField(input.accessKeyId, "AccessKey ID"),
      secretAccessKey: requireCloudField(input.secretAccessKey, "AccessKey Secret"),
      pathname: `/${config.bucket}`,
    });
    if (!response.ok) {
      mapCloudHttpError(response.status);
    }
    return { ok: true, capabilities: { canRead: true, canWrite: true } };
  },
  async browse(input) {
    const config = s3CompatibleAdapter.generateConfig(input);
    const region = input.region?.trim() || "us-east-1";
    const prefix = trimPrefixPath(input.path, config.rootPrefix);
    const response = await signedFetchAws({
      method: "GET",
      endpoint: new URL(config.endpoint),
      region,
      accessKeyId: requireCloudField(input.accessKeyId, "AccessKey ID"),
      secretAccessKey: requireCloudField(input.secretAccessKey, "AccessKey Secret"),
      pathname: `/${config.bucket}`,
      query: {
        "list-type": "2",
        delimiter: "/",
        prefix,
      },
    });
    if (!response.ok) {
      mapCloudHttpError(response.status);
    }
    const xml = await response.text();
    const directories = decodeXmlTagList(xml, "Prefix").map((entry) => ({
      name: entry.replace(prefix, "").replace(/\/$/, "") || entry.replace(/\/$/, ""),
      path: entry,
    }));
    const trimmedPrefix = prefix.replace(/\/$/, "");
    const parentPath =
      trimmedPrefix && trimmedPrefix.includes("/")
        ? trimmedPrefix.slice(0, trimmedPrefix.lastIndexOf("/") + 1)
        : config.rootPrefix || undefined;
    return {
      bucket: config.bucket,
      currentPath: prefix,
      ...(parentPath && parentPath !== prefix ? { parentPath } : {}),
      directories,
    };
  },
};

const huaweiObsAdapter: CloudProviderAdapter = {
  provider: "huawei-obs",
  generateConfig(input) {
    const region = requireCloudField(input.region, "Region");
    return {
      provider: "huawei-obs",
      region,
      endpoint: `https://obs.${region}.myhuaweicloud.com`,
      bucket: requireCloudField(input.bucket, "Bucket"),
      rootPrefix: normalizeRootPrefix(input.rootPrefix),
    };
  },
  async testConnection(input) {
    const config = huaweiObsAdapter.generateConfig(input);
    const response = await signedFetchObs({
      method: "HEAD",
      endpoint: new URL(config.endpoint),
      accessKeyId: requireCloudField(input.accessKeyId, "Access Key ID"),
      secretAccessKey: requireCloudField(input.secretAccessKey, "Secret Access Key"),
      bucket: config.bucket,
    });
    if (!response.ok) {
      mapCloudHttpError(response.status);
    }
    return { ok: true, capabilities: { canRead: true, canWrite: true } };
  },
  async browse(input) {
    const config = huaweiObsAdapter.generateConfig(input);
    const prefix = trimPrefixPath(input.path, config.rootPrefix);
    const response = await signedFetchObs({
      method: "GET",
      endpoint: new URL(config.endpoint),
      accessKeyId: requireCloudField(input.accessKeyId, "Access Key ID"),
      secretAccessKey: requireCloudField(input.secretAccessKey, "Secret Access Key"),
      bucket: config.bucket,
      query: {
        delimiter: "/",
        prefix,
      },
    });
    if (!response.ok) {
      mapCloudHttpError(response.status);
    }
    const xml = await response.text();
    const directories = decodeXmlTagList(xml, "Prefix").map((entry) => ({
      name: entry.replace(prefix, "").replace(/\/$/, "") || entry.replace(/\/$/, ""),
      path: entry,
    }));
    const trimmedPrefix = prefix.replace(/\/$/, "");
    const parentPath =
      trimmedPrefix && trimmedPrefix.includes("/")
        ? trimmedPrefix.slice(0, trimmedPrefix.lastIndexOf("/") + 1)
        : config.rootPrefix || undefined;
    return {
      bucket: config.bucket,
      currentPath: prefix,
      ...(parentPath && parentPath !== prefix ? { parentPath } : {}),
      directories,
    };
  },
};

const azureBlobAdapter: CloudProviderAdapter = {
  provider: "azure-blob",
  generateConfig(input) {
    const accountName = requireCloudField(input.accountName, "存储账号名");
    return {
      provider: "azure-blob",
      accountName,
      endpoint: `https://${accountName}.blob.core.windows.net`,
      bucket: requireCloudField(input.bucket, "容器"),
      rootPrefix: normalizeRootPrefix(input.rootPrefix),
    };
  },
  async testConnection(input) {
    const config = azureBlobAdapter.generateConfig(input);
    const response = await signedFetchAzure({
      method: "HEAD",
      endpoint: new URL(config.endpoint),
      accountName: config.accountName ?? "",
      secretAccessKey: requireCloudField(input.secretAccessKey, "Access Key"),
      pathname: `/${config.bucket}`,
      query: {
        restype: "container",
      },
    });
    if (!response.ok) {
      mapCloudHttpError(response.status);
    }
    return { ok: true, capabilities: { canRead: true, canWrite: true } };
  },
  async browse(input) {
    const config = azureBlobAdapter.generateConfig(input);
    const prefix = trimPrefixPath(input.path, config.rootPrefix);
    const response = await signedFetchAzure({
      method: "GET",
      endpoint: new URL(config.endpoint),
      accountName: config.accountName ?? "",
      secretAccessKey: requireCloudField(input.secretAccessKey, "Access Key"),
      pathname: `/${config.bucket}`,
      query: {
        restype: "container",
        comp: "list",
        delimiter: "/",
        prefix,
      },
    });
    if (!response.ok) {
      mapCloudHttpError(response.status);
    }
    const xml = await response.text();
    const directories = decodeAzureBlobPrefixes(xml).map((entry) => ({
      name: entry.replace(prefix, "").replace(/\/$/, "") || entry.replace(/\/$/, ""),
      path: entry,
    }));
    const trimmedPrefix = prefix.replace(/\/$/, "");
    const parentPath =
      trimmedPrefix && trimmedPrefix.includes("/")
        ? trimmedPrefix.slice(0, trimmedPrefix.lastIndexOf("/") + 1)
        : config.rootPrefix || undefined;
    return {
      bucket: config.bucket,
      currentPath: prefix,
      ...(parentPath && parentPath !== prefix ? { parentPath } : {}),
      directories,
    };
  },
};

const aliyunOssAdapter: CloudProviderAdapter = {
  provider: "aliyun-oss",
  generateConfig(input) {
    const region = requireCloudField(input.region, "Region");
    return {
      provider: "aliyun-oss",
      region,
      endpoint: `https://oss-${region}.aliyuncs.com`,
      bucket: requireCloudField(input.bucket, "Bucket"),
      rootPrefix: normalizeRootPrefix(input.rootPrefix),
    };
  },
  async testConnection(input) {
    const config = aliyunOssAdapter.generateConfig(input);
    const response = await signedFetchAliyun({
      method: "HEAD",
      endpoint: new URL(config.endpoint),
      accessKeyId: requireCloudField(input.accessKeyId, "AccessKey ID"),
      secretAccessKey: requireCloudField(input.secretAccessKey, "AccessKey Secret"),
      bucket: config.bucket,
    });
    if (!response.ok) {
      mapCloudHttpError(response.status);
    }
    return { ok: true, capabilities: { canRead: true, canWrite: true } };
  },
  async browse(input) {
    const config = aliyunOssAdapter.generateConfig(input);
    const prefix = trimPrefixPath(input.path, config.rootPrefix);
    const response = await signedFetchAliyun({
      method: "GET",
      endpoint: new URL(config.endpoint),
      accessKeyId: requireCloudField(input.accessKeyId, "AccessKey ID"),
      secretAccessKey: requireCloudField(input.secretAccessKey, "AccessKey Secret"),
      bucket: config.bucket,
      query: {
        delimiter: "/",
        prefix,
      },
    });
    if (!response.ok) {
      mapCloudHttpError(response.status);
    }
    const xml = await response.text();
    const directories = decodeXmlTagList(xml, "Prefix").map((entry) => ({
      name: entry.replace(prefix, "").replace(/\/$/, "") || entry.replace(/\/$/, ""),
      path: entry,
    }));
    const trimmedPrefix = prefix.replace(/\/$/, "");
    const parentPath =
      trimmedPrefix && trimmedPrefix.includes("/")
        ? trimmedPrefix.slice(0, trimmedPrefix.lastIndexOf("/") + 1)
        : config.rootPrefix || undefined;
    return {
      bucket: config.bucket,
      currentPath: prefix,
      ...(parentPath && parentPath !== prefix ? { parentPath } : {}),
      directories,
    };
  },
};

const ADAPTERS: Record<CloudWorkspaceProvider, CloudProviderAdapter> = {
  "aliyun-oss": aliyunOssAdapter,
  "aws-s3": awsS3Adapter,
  "azure-blob": azureBlobAdapter,
  "huawei-obs": huaweiObsAdapter,
  "s3-compatible": s3CompatibleAdapter,
};

export function getCloudProviderAdapter(provider: CloudWorkspaceProvider) {
  return ADAPTERS[provider];
}
