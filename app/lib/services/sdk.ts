import EJSON from 'ejson';
import isEmpty from 'lodash/isEmpty';
import { DDPSDK } from '@rocket.chat/ddp-client';
import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';

import { twoFactor } from './twoFactor';
import { store as reduxStore } from '../store/auxStore';
import { random } from '../methods/helpers';
import { BASIC_AUTH_KEY } from '../constants';
import UserPreferences from '../methods/userPreferences';

class Sdk {
	private sdk: DDPSDK | undefined;
	private code: any;
	private headers: Record<string, string> = {
		'User-Agent': `RC Mobile; ${
			Platform.OS
		} ${DeviceInfo.getSystemVersion()}; v${DeviceInfo.getVersion()} (${DeviceInfo.getBuildNumber()})`
	};

	async initialize(server: string) {
		this.code = null;
		this.sdk = await DDPSDK.create(server);
		const basicAuth = UserPreferences.getString(`${BASIC_AUTH_KEY}-${server}`);
		this.setBasicAuth(basicAuth);
		this.sdk.rest.handleTwoFactorChallenge(this.twoFactorHandler);
		return this.sdk;
	}

	get current() {
		return this.sdk;
	}

	/**
	 * TODO: evaluate the need for assigning "null" to this.sdk
	 * I'm returning "null" because we need to remove both instances of this.sdk here and on rocketchat.js
	 */
	disconnect() {
		if (this.sdk) {
			this.sdk.connection.close();
			this.sdk = undefined;
		}
		return null;
	}

	setBasicAuth(basicAuth: string | null): void {
		if (basicAuth) {
			this.headers.Authorization = `Basic ${basicAuth}`;
		}
	}

	get(endpoint: string, params: any): any {
		return this.current?.rest.get(endpoint, params, { headers: this.headers });
	}

	post(endpoint: string, params: any): Promise<any> {
		return new Promise(async (resolve, reject) => {
			const isMethodCall = endpoint?.match('/method.call/');
			try {
				const result = await this.current?.rest.post(endpoint, params, { headers: this.headers });

				/**
				 * if API_Use_REST_For_DDP_Calls is enabled and it's a method call,
				 * responses have a different object structure
				 */
				if (isMethodCall) {
					const response = JSON.parse(result.message);
					if (response?.error) {
						throw response.error;
					}
					return resolve(response.result);
				}
				return resolve(result);
			} catch (e: any) {
				reject(e);
			}
		});
	}

	delete(endpoint: string, params: any): any {
		return this.current?.rest.delete(endpoint, params, { headers: this.headers });
	}

	async twoFactorHandler({
		method,
		// emailOrUsername, TODO: what is this for?
		invalidAttempt
	}: {
		method: 'totp' | 'email' | 'password';
		invalidAttempt?: boolean;
	}): Promise<string> {
		const result = await twoFactor({ method, invalid: !!invalidAttempt });
		return result.twoFactorCode;
	}

	async login(credentials: any): Promise<any> {
		try {
			const loginResult = await this.post('/v1/login', credentials);
			await this.current?.account.loginWithToken(loginResult.data.authToken);
			return loginResult.data;
		} catch (e) {
			return Promise.reject(e);
		}
	}

	methodCall(...args: any[]): Promise<any> {
		return new Promise(async (resolve, reject) => {
			try {
				const result = await this.current?.client.callAsyncWithOptions(...args, this.code || '');
				return resolve(result);
			} catch (e: any) {
				if (e.error && (e.error === 'totp-required' || e.error === 'totp-invalid')) {
					const { details } = e;
					try {
						this.code = await twoFactor({ method: details?.method, invalid: e.error === 'totp-invalid' });
						return resolve(this.methodCall(...args));
					} catch {
						// twoFactor was canceled
						return resolve({});
					}
				} else {
					reject(e);
				}
			}
		});
	}

	methodCallWrapper(method: string, ...params: any[]): Promise<any> {
		const { API_Use_REST_For_DDP_Calls } = reduxStore.getState().settings;
		const { user } = reduxStore.getState().login;
		if (API_Use_REST_For_DDP_Calls) {
			const url = isEmpty(user) ? 'method.callAnon' : 'method.call';
			// @ts-ignore
			return this.post(`/v1/${url}/${method}`, {
				message: EJSON.stringify({ msg: 'method', id: random(10), method, params })
			});
		}
		const parsedParams = params.map(param => {
			if (param instanceof Date) {
				return { $date: new Date(param).getTime() };
			}
			return param;
		});
		return this.methodCall(method, ...parsedParams);
	}

	subscribe(...args: any[]) {
		return this.current?.client.subscribe(...args);
	}

	onCollection(...args: any[]) {
		return this.current?.client.onCollection(...args);
	}

	stream(...args: any[]) {
		return this.current?.stream(...args);
	}

	_stream(name: string, data: unknown, cb: (...data: any) => void) {
		const [key, args] = Array.isArray(data) ? data : [data];
		if (!this.current) {
			return;
		}
		const subscription = this.current.client.subscribe(`stream-${name}`, key, { useCollection: false, args: [args] });

		const stop = subscription.stop.bind(subscription);
		const cancel = [
			() => stop(),
			this.current.client.onCollection(`stream-${name}`, (data: any) => {
				if (data.collection !== `stream-${name}`) {
					return;
				}
				if (data.msg === 'added') {
					return;
				}
				if (data.fields.eventName === key) {
					cb(data);
				}
			})
		];

		return Object.assign(subscription, {
			stop: () => {
				cancel.forEach(fn => fn());
			}
		});
	}
}

const sdk = new Sdk();

export default sdk;
