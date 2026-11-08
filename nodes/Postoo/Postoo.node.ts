import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INode,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

interface PostooAccount {
	id: string;
	platform: string;
	accountName: string;
	provider: string;
	externalAccountId: string | null;
	status: string;
}

interface PostooPublishResponse {
	data: {
		externalPostId: string;
		platform: string;
		status: 'published' | 'scheduled';
	};
}

interface PostooAccountsResponse {
	data: {
		items: PostooAccount[];
	};
}

export interface PostooErrorDetails {
	code: string;
	requestId?: string;
	providerCode?: string;
}

export const POSTOO_ERROR_MESSAGES: Record<string, string> = {
	invalid_api_key: 'The Postoo API key is invalid or has been revoked.',
	rate_limit_exceeded: 'The Postoo API rate limit has been reached. Try again later.',
	account_not_found: 'The selected social account was not found.',
	account_inactive: 'The selected social account is inactive.',
	account_disconnected: 'The selected social account is disconnected. Reconnect it in Postoo.',
	publish_rejected: 'The social network rejected the post. Check the content and media.',
	publish_failed_unknown:
		'Postoo cannot confirm whether the post was published. Do not retry automatically. Check the destination account at the social provider before any manual retry.',
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null
		? (value as Record<string, unknown>)
		: undefined;
}

function parseErrorEnvelope(value: unknown): PostooErrorDetails | undefined {
	let parsedValue = value;

	if (typeof parsedValue === 'string') {
		try {
			parsedValue = JSON.parse(parsedValue) as unknown;
		} catch {
			return undefined;
		}
	}

	const envelope = asRecord(parsedValue);
	const error = asRecord(envelope?.error);
	if (typeof error?.code !== 'string') {
		return undefined;
	}

	return {
		code: error.code,
		...(typeof error.requestId === 'string' ? { requestId: error.requestId } : {}),
	};
}

export function getPostooErrorDetails(error: unknown): PostooErrorDetails | undefined {
	const root = asRecord(error);
	const response = asRecord(root?.response);
	const cause = asRecord(root?.cause);
	const causeResponse = asRecord(cause?.response);
	const candidates = [
		root,
		response?.body,
		response?.data,
		causeResponse?.body,
		causeResponse?.data,
	];

	for (const candidate of candidates) {
		const parsed = parseErrorEnvelope(candidate);
		if (parsed) {
			return parsed;
		}
	}

	return undefined;
}

function resolvePostooErrorDetails(
	error: unknown,
	fallbackCode?: string,
): PostooErrorDetails | undefined {
	const details = getPostooErrorDetails(error);
	if (
		fallbackCode === undefined ||
		(details !== undefined &&
			Object.prototype.hasOwnProperty.call(POSTOO_ERROR_MESSAGES, details.code))
	) {
		return details ?? (fallbackCode === undefined ? undefined : { code: fallbackCode });
	}

	return {
		code: fallbackCode,
		...(details?.requestId ? { requestId: details.requestId } : {}),
		...(details?.code ? { providerCode: details.code } : {}),
	};
}

function parsePublishResponse(value: unknown): PostooPublishResponse['data'] | undefined {
	const data = asRecord(asRecord(value)?.data);
	if (
		typeof data?.externalPostId !== 'string' ||
		!data.externalPostId.trim() ||
		typeof data.platform !== 'string' ||
		!data.platform.trim() ||
		(data.status !== 'published' && data.status !== 'scheduled')
	) {
		return undefined;
	}

	return {
		externalPostId: data.externalPostId,
		platform: data.platform,
		status: data.status,
	};
}

export function getPostooErrorMessage(code: string): string {
	return POSTOO_ERROR_MESSAGES[code] ?? 'Postoo returned an error.';
}

function createPostooApiError(
	node: INode,
	error: unknown,
	itemIndex?: number,
	fallbackCode?: string,
): NodeApiError {
	const details = resolvePostooErrorDetails(error, fallbackCode);
	const message = details ? getPostooErrorMessage(details.code) : 'The Postoo API request failed.';
	const descriptionParts = details
		? [`Postoo error code: ${details.code}.`]
		: ['Check the credential and request data, then try again.'];

	if (details?.requestId) {
		descriptionParts.push(`Request ID: ${details.requestId}.`);
	}
	if (details?.providerCode) {
		descriptionParts.push(`Provider error code: ${details.providerCode}.`);
	}

	return new NodeApiError(
		node,
		{
			message,
			...(details?.code ? { code: details.code } : {}),
			...(details?.requestId ? { requestId: details.requestId } : {}),
			...(details?.providerCode ? { providerCode: details.providerCode } : {}),
		} as JsonObject,
		{
			message,
			description: descriptionParts.join(' '),
			...(itemIndex === undefined ? {} : { itemIndex }),
		},
	);
}

export class Postoo implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Postoo',
		name: 'postoo',
		icon: { light: 'file:postoo.svg', dark: 'file:postoo.dark.svg' },
		group: ['output'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Publish posts to social media through Postoo, including LinkedIn, Facebook, Instagram, and TikTok',
		defaults: {
			name: 'Postoo',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'postooApi',
				required: true,
			},
		],
		requestDefaults: {
			baseURL: '={{$credentials.baseUrl}}',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
		},
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Post', value: 'post' },
					{ name: 'Account', value: 'account' },
				],
				default: 'post',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['post'] } },
				options: [
					{
						name: 'Publish',
						value: 'publish',
						description: 'Publish a post to a connected social account',
						action: 'Publish a post',
					},
				],
				default: 'publish',
			},
			{
				displayName: 'Social Account Name or ID',
				name: 'socialAccountId',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getSocialAccounts',
				},
				required: true,
				default: '',
				displayOptions: { show: { resource: ['post'], operation: ['publish'] } },
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Content',
				name: 'content',
				type: 'string',
				typeOptions: { rows: 6 },
				required: true,
				default: '',
				displayOptions: { show: { resource: ['post'], operation: ['publish'] } },
				description: 'The post text, up to 5,000 characters; plain text only',
			},
			{
				displayName: 'Media URL',
				name: 'mediaUrl',
				type: 'string',
				default: '',
				placeholder: 'https://example.com/image.jpg',
				displayOptions: { show: { resource: ['post'], operation: ['publish'] } },
				description: 'Optional public URL of an image or video to attach',
			},
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['post'], operation: ['publish'] } },
				description:
					'Optional 8 to 128 character correlation key for forward compatibility; the current Postoo API does not guarantee durable replay or deduplication',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['account'] } },
				options: [
					{
						name: 'List',
						value: 'list',
						description: 'List connected social accounts',
						action: 'List connected accounts',
					},
				],
				default: 'list',
			},
		],
	};

	methods = {
		loadOptions: {
			async getSocialAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				try {
					const credentials = await this.getCredentials('postooApi');
					const response = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'postooApi',
						{
							method: 'GET',
							baseURL: credentials.baseUrl as string,
							url: '/accounts',
							json: true,
						},
					)) as PostooAccountsResponse;

					return response.data.items.map((account) => ({
						name: `${account.platform} — ${account.accountName}`,
						value: account.id,
						description: `Provider: ${account.provider}`,
					}));
				} catch (error) {
					throw createPostooApiError(this.getNode(), error);
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		if (items.length > 1 && !this.continueOnFail()) {
			for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
				const resource = this.getNodeParameter('resource', itemIndex) as string;
				const operation = this.getNodeParameter('operation', itemIndex) as string;

				if (resource === 'post' && operation === 'publish') {
					throw new NodeOperationError(
						this.getNode(),
						'Set the node\'s "On Error" behavior to continue with per-item output before publishing multiple input items. Otherwise, a later item failure can hide an earlier successful publication and make a rerun create a duplicate post.',
						{ itemIndex },
					);
				}
			}
		}

		const credentials = await this.getCredentials('postooApi');

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			const resource = this.getNodeParameter('resource', itemIndex) as string;
			const operation = this.getNodeParameter('operation', itemIndex) as string;
			const isPublish = resource === 'post' && operation === 'publish';

			if (isPublish && this.getNode().retryOnFail) {
				throw new NodeOperationError(
					this.getNode(),
					'Disable "Retry On Fail" for Postoo publish operations. The Postoo API cannot safely replay an ambiguous publication, and an automatic retry may create a duplicate post.',
					{ itemIndex },
				);
			}

			if (isPublish && this.isToolExecution()) {
				throw new NodeOperationError(
					this.getNode(),
					'Postoo publish operations cannot run as an AI Agent tool. An agent could repeat an ambiguous publication and create a duplicate post. Run the node as a regular workflow step instead.',
					{ itemIndex },
				);
			}

			let publishRequestStarted = false;

			try {
				if (isPublish) {
					const socialAccountId = this.getNodeParameter('socialAccountId', itemIndex) as string;
					const content = this.getNodeParameter('content', itemIndex) as string;
					const mediaUrl = this.getNodeParameter('mediaUrl', itemIndex, '') as string;
					const idempotencyKey = this.getNodeParameter('idempotencyKey', itemIndex, '') as string;

					const body: Record<string, unknown> = {
						socialAccountId,
						content,
					};
					if (mediaUrl.trim()) {
						body.mediaUrls = [mediaUrl.trim()];
					}

					const headers: Record<string, string> = {};
					if (idempotencyKey.trim()) {
						headers['Idempotency-Key'] = idempotencyKey.trim();
					}

					publishRequestStarted = true;
					const response = await this.helpers.httpRequestWithAuthentication.call(
						this,
						'postooApi',
						{
							method: 'POST',
							baseURL: credentials.baseUrl as string,
							url: '/publish',
							headers,
							body,
							json: true,
						},
					);
					const publishData = parsePublishResponse(response);
					if (!publishData) {
						throw new NodeOperationError(
							this.getNode(),
							'Postoo returned an invalid publish response.',
							{ itemIndex },
						);
					}

					returnData.push({
						json: publishData as unknown as IDataObject,
						pairedItem: { item: itemIndex },
					});
				} else if (resource === 'account' && operation === 'list') {
					const response = (await this.helpers.httpRequestWithAuthentication.call(
						this,
						'postooApi',
						{
							method: 'GET',
							baseURL: credentials.baseUrl as string,
							url: '/accounts',
							json: true,
						},
					)) as PostooAccountsResponse;

					for (const account of response.data.items) {
						returnData.push({
							json: account as unknown as IDataObject,
							pairedItem: { item: itemIndex },
						});
					}
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`Unknown resource and operation combination: ${resource}/${operation}`,
						{ itemIndex },
					);
				}
			} catch (error) {
				const fallbackCode =
					isPublish && publishRequestStarted ? 'publish_failed_unknown' : undefined;
				const details = resolvePostooErrorDetails(error, fallbackCode);
				const apiError = createPostooApiError(this.getNode(), error, itemIndex, fallbackCode);

				if (this.continueOnFail()) {
					returnData.push({
						json: {
							error: details?.code ?? 'postoo_request_failed',
							message: details
								? getPostooErrorMessage(details.code)
								: 'The Postoo API request failed.',
							...(details?.requestId ? { requestId: details.requestId } : {}),
							...(details?.providerCode ? { providerCode: details.providerCode } : {}),
						},
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				throw apiError;
			}
		}

		return [returnData];
	}
}
