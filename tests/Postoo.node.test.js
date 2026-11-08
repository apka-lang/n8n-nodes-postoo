const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
	Postoo,
	getPostooErrorDetails,
	getPostooErrorMessage,
} = require('../dist/nodes/Postoo/Postoo.node.js');

function createNodeContext(parameters, request, continueOnFail = false, nodeOverrides = {}) {
	return {
		getInputData: () => [{ json: { sourceId: 'source-1' } }],
		getCredentials: async () => ({ baseUrl: 'https://postoo.example/api/v1' }),
		getNodeParameter: (name, _itemIndex, fallback) => parameters[name] ?? fallback,
		getNode: () => ({
			parameters: {},
			type: 'n8n-nodes-postoo.postoo',
			typeVersion: 1,
			position: [0, 0],
			name: 'Postoo',
			...nodeOverrides,
		}),
		continueOnFail: () => continueOnFail,
		isToolExecution: () => false,
		helpers: {
			httpRequestWithAuthentication: request,
		},
	};
}

test('extracts structured Postoo errors from HTTP response bodies', () => {
	assert.deepEqual(
		getPostooErrorDetails({
			response: {
				body: JSON.stringify({
					error: {
						code: 'account_not_found',
						message: 'Localized upstream message',
						requestId: 'request-123',
					},
				}),
			},
		}),
		{ code: 'account_not_found', requestId: 'request-123' },
	);
});

test('maps stable Postoo error codes to English messages', () => {
	assert.equal(
		getPostooErrorMessage('account_disconnected'),
		'The selected social account is disconnected. Reconnect it in Postoo.',
	);
	assert.equal(
		getPostooErrorMessage('publish_failed_unknown'),
		'Postoo cannot confirm whether the post was published. Do not retry automatically. Check the destination account at the social provider before any manual retry.',
	);
	assert.equal(getPostooErrorMessage('new_error_code'), 'Postoo returned an error.');
});

test('does not promise durable idempotent replay in the node UI', () => {
	const property = new Postoo().description.properties.find(
		(candidate) => candidate.name === 'idempotencyKey',
	);

	assert.match(property.description, /does not guarantee durable replay or deduplication/);
	assert.doesNotMatch(property.description, /return the original post/);
});

test('blocks publish before the provider call when Retry On Fail is enabled', async () => {
	let requestCalls = 0;
	const context = createNodeContext(
		{
			resource: 'post',
			operation: 'publish',
			socialAccountId: 'account-1',
			content: 'A test post',
			mediaUrl: '',
			idempotencyKey: '',
		},
		async function request() {
			requestCalls += 1;
		},
		false,
		{ retryOnFail: true },
	);

	await assert.rejects(
		() => new Postoo().execute.call(context),
		/Disable "Retry On Fail" for Postoo publish operations/,
	);
	assert.equal(requestCalls, 0);
});

test('blocks publish before the provider call when executed as an AI Agent tool', async () => {
	let requestCalls = 0;
	const context = createNodeContext(
		{
			resource: 'post',
			operation: 'publish',
			socialAccountId: 'account-1',
			content: 'A test post',
			mediaUrl: '',
			idempotencyKey: '',
		},
		async function request() {
			requestCalls += 1;
		},
	);
	context.isToolExecution = () => true;

	await assert.rejects(() => new Postoo().execute.call(context), /cannot run as an AI Agent tool/);
	assert.equal(requestCalls, 0);
});

test('blocks multi-item publish before any provider call unless per-item errors are preserved', async () => {
	let requestCalls = 0;
	const context = createNodeContext(
		{
			resource: 'post',
			operation: 'publish',
			socialAccountId: 'account-1',
			content: 'A test post',
			mediaUrl: '',
			idempotencyKey: '',
		},
		async function request() {
			requestCalls += 1;
		},
	);
	context.getInputData = () => [
		{ json: { sourceId: 'source-1' } },
		{ json: { sourceId: 'source-2' } },
	];

	await assert.rejects(
		() => new Postoo().execute.call(context),
		/continue with per-item output before publishing multiple input items/,
	);
	assert.equal(requestCalls, 0);
});

test('preserves each result when multi-item publish continues on error', async () => {
	let requestCalls = 0;
	const context = createNodeContext(
		{
			resource: 'post',
			operation: 'publish',
			socialAccountId: 'account-1',
			content: 'A test post',
			mediaUrl: '',
			idempotencyKey: '',
		},
		async function request() {
			requestCalls += 1;
			if (requestCalls === 1) {
				return {
					data: {
						externalPostId: 'external-1',
						platform: 'linkedin',
						status: 'published',
					},
				};
			}
			throw {
				response: {
					body: { error: { code: 'account_not_found', requestId: 'request-2' } },
				},
			};
		},
		true,
	);
	context.getInputData = () => [
		{ json: { sourceId: 'source-1' } },
		{ json: { sourceId: 'source-2' } },
	];

	const output = await new Postoo().execute.call(context);

	assert.equal(requestCalls, 2);
	assert.equal(output[0][0].json.externalPostId, 'external-1');
	assert.deepEqual(output[0][0].pairedItem, { item: 0 });
	assert.deepEqual(output[0][1], {
		json: {
			error: 'account_not_found',
			message: 'The selected social account was not found.',
			requestId: 'request-2',
		},
		pairedItem: { item: 1 },
	});
});

test('publishes with authenticated helper, media, idempotency, and item pairing', async () => {
	const calls = [];
	const request = async function request(credentialType, options) {
		calls.push({ credentialType, options, context: this });
		return {
			data: {
				externalPostId: 'external-1',
				platform: 'linkedin',
				status: 'published',
			},
		};
	};
	const context = createNodeContext(
		{
			resource: 'post',
			operation: 'publish',
			socialAccountId: 'account-1',
			content: 'A test post',
			mediaUrl: ' https://example.com/image.jpg ',
			idempotencyKey: ' source-1-linkedin ',
		},
		request,
	);

	const output = await new Postoo().execute.call(context);

	assert.deepEqual(output, [
		[
			{
				json: {
					externalPostId: 'external-1',
					platform: 'linkedin',
					status: 'published',
				},
				pairedItem: { item: 0 },
			},
		],
	]);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].credentialType, 'postooApi');
	assert.equal(calls[0].context, context);
	assert.deepEqual(calls[0].options.body, {
		socialAccountId: 'account-1',
		content: 'A test post',
		mediaUrls: ['https://example.com/image.jpg'],
	});
	assert.deepEqual(calls[0].options.headers, {
		'Idempotency-Key': 'source-1-linkedin',
	});
	assert.equal(calls[0].options.headers.Authorization, undefined);
});

test('omits optional publish fields when they are empty', async () => {
	let requestOptions;
	const context = createNodeContext(
		{
			resource: 'post',
			operation: 'publish',
			socialAccountId: 'account-1',
			content: 'Text only',
			mediaUrl: ' ',
			idempotencyKey: '',
		},
		async function request(_credentialType, options) {
			requestOptions = options;
			return { data: { externalPostId: 'external-2', platform: 'facebook', status: 'published' } };
		},
	);

	await new Postoo().execute.call(context);

	assert.deepEqual(requestOptions.body, {
		socialAccountId: 'account-1',
		content: 'Text only',
	});
	assert.deepEqual(requestOptions.headers, {});
});

test('returns a safe English error when continue-on-fail is enabled', async () => {
	const context = createNodeContext(
		{
			resource: 'post',
			operation: 'publish',
			socialAccountId: 'missing-account',
			content: 'A test post',
			mediaUrl: '',
			idempotencyKey: '',
		},
		async function request() {
			throw {
				response: {
					body: {
						error: {
							code: 'account_not_found',
							message: 'Localized upstream message',
							requestId: 'request-456',
						},
					},
				},
			};
		},
		true,
	);

	const output = await new Postoo().execute.call(context);

	assert.deepEqual(output, [
		[
			{
				json: {
					error: 'account_not_found',
					message: 'The selected social account was not found.',
					requestId: 'request-456',
				},
				pairedItem: { item: 0 },
			},
		],
	]);
});

test('treats an unstructured publish transport failure as an unknown outcome', async () => {
	const context = createNodeContext(
		{
			resource: 'post',
			operation: 'publish',
			socialAccountId: 'account-1',
			content: 'A test post',
			mediaUrl: '',
			idempotencyKey: '',
		},
		async function request() {
			throw new Error('socket reset');
		},
	);

	await assert.rejects(
		() => new Postoo().execute.call(context),
		(error) => {
			assert.equal(
				error.message,
				'Postoo cannot confirm whether the post was published. Do not retry automatically. Check the destination account at the social provider before any manual retry.',
			);
			assert.match(error.description, /Postoo error code: publish_failed_unknown/);
			return true;
		},
	);
});

test('returns the unknown-outcome code for an unstructured publish failure with continue-on-fail', async () => {
	const context = createNodeContext(
		{
			resource: 'post',
			operation: 'publish',
			socialAccountId: 'account-1',
			content: 'A test post',
			mediaUrl: '',
			idempotencyKey: '',
		},
		async function request() {
			throw new Error('socket reset');
		},
		true,
	);

	const output = await new Postoo().execute.call(context);

	assert.deepEqual(output, [
		[
			{
				json: {
					error: 'publish_failed_unknown',
					message:
						'Postoo cannot confirm whether the post was published. Do not retry automatically. Check the destination account at the social provider before any manual retry.',
				},
				pairedItem: { item: 0 },
			},
		],
	]);
});

test('does not report an unknown publication when local preparation fails before the request', async () => {
	let requestCalls = 0;
	const context = createNodeContext(
		{
			resource: 'post',
			operation: 'publish',
			socialAccountId: 'account-1',
			content: 'A test post',
			mediaUrl: 42,
			idempotencyKey: '',
		},
		async function request() {
			requestCalls += 1;
		},
	);

	await assert.rejects(
		() => new Postoo().execute.call(context),
		(error) => {
			assert.equal(error.message, 'The Postoo API request failed.');
			assert.doesNotMatch(error.description, /publish_failed_unknown/);
			return true;
		},
	);
	assert.equal(requestCalls, 0);
});

test('lists connected accounts and preserves the source item link', async () => {
	const context = createNodeContext(
		{ resource: 'account', operation: 'list' },
		async function request() {
			return {
				data: {
					items: [
						{
							id: 'account-1',
							platform: 'linkedin',
							accountName: 'Postoo',
							provider: 'linkedin',
							externalAccountId: 'external-account-1',
							status: 'active',
						},
					],
				},
			};
		},
	);

	const output = await new Postoo().execute.call(context);

	assert.equal(output[0][0].json.id, 'account-1');
	assert.deepEqual(output[0][0].pairedItem, { item: 0 });
});
