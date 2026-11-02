const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
	Postoo,
	getPostooErrorDetails,
	getPostooErrorMessage,
} = require('../dist/nodes/Postoo/Postoo.node.js');

function createNodeContext(parameters, request, continueOnFail = false) {
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
		}),
		continueOnFail: () => continueOnFail,
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
	assert.equal(getPostooErrorMessage('new_error_code'), 'Postoo returned an error.');
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
