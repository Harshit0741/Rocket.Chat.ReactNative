import React, { useContext, useEffect, useRef, useState } from 'react';
import { StyleProp, TextStyle, View } from 'react-native';
import { AVPlaybackStatus } from 'expo-av';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSharedValue } from 'react-native-reanimated';

import Markdown from '../../../markdown';
import MessageContext from '../../Context';
import { TGetCustomEmoji } from '../../../../definitions/IEmoji';
import { IAttachment, IUserMessage } from '../../../../definitions';
import { useTheme } from '../../../../theme';
import { downloadMediaFile, getMediaCache } from '../../../../lib/methods/handleMediaDownload';
import { fetchAutoDownloadEnabled } from '../../../../lib/methods/autoDownloadPreference';
import styles from './styles';
import Slider from './Slider';
import AudioRate from './AudioRate';
import PlayButton from './PlayButton';
import handleAudioMedia from '../../../../lib/methods/handleAudioMedia';

interface IMessageAudioProps {
	file: IAttachment;
	isReply?: boolean;
	style?: StyleProp<TextStyle>[];
	getCustomEmoji: TGetCustomEmoji;
	author?: IUserMessage;
}

const MessageAudio = ({ file, getCustomEmoji, author, isReply, style }: IMessageAudioProps) => {
	const [loading, setLoading] = useState(true);
	const [paused, setPaused] = useState(true);
	const [cached, setCached] = useState(false);

	const duration = useSharedValue(0);
	const currentTime = useSharedValue(0);

	const { baseUrl, user } = useContext(MessageContext);
	const { colors } = useTheme();

	const audioUri = useRef<string>('');
	const rate = useRef<number>(1);

	const onPlaybackStatusUpdate = (status: AVPlaybackStatus) => {
		if (status) {
			onPlaying(status);
			onLoad(status);
			onProgress(status);
			onEnd(status);
		}
	};

	const loadAudio = async (audio: string) => {
		await handleAudioMedia.loadAudio(audio);
		audioUri.current = audio;
		handleAudioMedia.setOnPlaybackStatusUpdate(audio, onPlaybackStatusUpdate);
	};

	const onPlaying = (data: AVPlaybackStatus) => {
		if (data.isLoaded && data.isPlaying) {
			setPaused(false);
		} else {
			setPaused(true);
		}
	};

	const onLoad = (data: AVPlaybackStatus) => {
		if (data.isLoaded && data.durationMillis) {
			const durationSeconds = data.durationMillis / 1000;
			duration.value = durationSeconds > 0 ? durationSeconds : 0;
			rate.current = data.rate;
		}
	};

	const onProgress = (data: AVPlaybackStatus) => {
		if (data.isLoaded) {
			const currentSecond = data.positionMillis / 1000;
			if (currentSecond <= duration.value) {
				currentTime.value = currentSecond;
			}
		}
	};

	const onEnd = (data: AVPlaybackStatus) => {
		if (data.isLoaded) {
			if (data.didJustFinish) {
				try {
					setPaused(true);
					currentTime.value = 0;
				} catch {
					// do nothing
				}
			}
		}
	};

	const setPosition = async (time: number) => {
		await handleAudioMedia.setPositionAsync(audioUri.current, time);
	};

	const getUrl = () => {
		let url = file.audio_url;
		if (url && !url.startsWith('http')) {
			url = `${baseUrl}${file.audio_url}`;
		}
		return url;
	};

	const togglePlayPause = async () => {
		try {
			if (!paused) {
				await handleAudioMedia.pauseAudio(audioUri.current);
			} else {
				await handleAudioMedia.playAudio(audioUri.current);
			}
		} catch {
			// Do nothing
		}
	};

	const setRate = async (value = 1.0) => {
		await handleAudioMedia.setRateAsync(audioUri.current, value);
	};

	const handleDownload = async () => {
		setLoading(true);
		try {
			const url = getUrl();
			if (url) {
				const audio = await downloadMediaFile({
					downloadUrl: `${url}?rc_uid=${user.id}&rc_token=${user.token}`,
					type: 'audio',
					mimeType: file.audio_type
				});
				await loadAudio(audio);
				setLoading(false);
				setCached(true);
			}
		} catch {
			setLoading(false);
			setCached(false);
		}
	};

	const handleAutoDownload = async () => {
		const url = getUrl();
		try {
			if (url) {
				const isCurrentUserAuthor = author?._id === user.id;
				const isAutoDownloadEnabled = fetchAutoDownloadEnabled('audioPreferenceDownload');
				if (isAutoDownloadEnabled || isCurrentUserAuthor) {
					await handleDownload();
					return;
				}
				setLoading(false);
				setCached(false);
			}
		} catch {
			// Do nothing
		}
	};

	const onPress = () => {
		if (loading) {
			return;
		}
		if (cached) {
			togglePlayPause();
			return;
		}
		handleDownload();
	};

	useEffect(() => {
		const handleCache = async () => {
			const cachedAudioResult = await getMediaCache({
				type: 'audio',
				mimeType: file.audio_type,
				urlToCache: getUrl()
			});
			if (cachedAudioResult?.exists) {
				await loadAudio(cachedAudioResult.uri);
				setLoading(false);
				setCached(true);
				return;
			}
			if (isReply) {
				setLoading(false);
				return;
			}
			await handleAutoDownload();
		};
		handleCache();
	}, []);

	useEffect(() => {
		if (paused) {
			deactivateKeepAwake();
		} else {
			activateKeepAwakeAsync();
		}
	}, [paused]);

	if (!baseUrl) {
		return null;
	}
	return (
		<>
			<Markdown msg={file.description} style={[isReply && style]} username={user.username} getCustomEmoji={getCustomEmoji} />
			<View
				style={[
					styles.audioContainer,
					{ backgroundColor: colors.audioComponentBackground, borderColor: colors.audioBorderColor }
				]}
			>
				<PlayButton disabled={isReply} loading={loading} paused={paused} cached={cached} onPress={onPress} />
				<Slider currentTime={currentTime} duration={duration} loaded={!isReply && cached} onChangeTime={setPosition} />
				<AudioRate onChange={setRate} loaded={!isReply && cached} rate={rate.current} />
			</View>
		</>
	);
};

export default MessageAudio;