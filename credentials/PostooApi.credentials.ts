import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class PostooApi implements ICredentialType {
	name = 'postooApi';

	displayName = 'Postoo API';

	icon = { light: 'file:postoo.svg', dark: 'file:postoo.dark.svg' } as const;

	documentationUrl = 'https://github.com/apka-lang/n8n-nodes-postoo?tab=readme-ov-file#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Create an API key in Postoo under Settings → API Keys',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://postoo.pl/api/v1',
			required: true,
			description: 'Change only when using a preview or self-hosted Postoo instance',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/accounts',
			method: 'GET',
		},
	};
}
