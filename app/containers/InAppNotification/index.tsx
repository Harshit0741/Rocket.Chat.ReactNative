import React, { ElementType, memo, useEffect } from 'react';
import { Easing, Notifier, NotifierRoot } from 'react-native-notifier';
import * as Haptics from 'expo-haptics';

import NotifierComponent, { INotifierComponent } from './NotifierComponent';
import EventEmitter from '../../lib/methods/helpers/events';
import Navigation from '../../lib/navigation/appNavigation';
import { getActiveRoute } from '../../lib/methods/helpers/navigation';
import { useAppSelector } from '../../lib/hooks';
import userPreferences from '../../lib/methods/userPreferences';
import { NOTIFICATION_IN_APP_VIBRATION } from '../../lib/constants';

export const INAPP_NOTIFICATION_EMITTER = 'NotificationInApp';

const InAppNotification = memo(() => {
	const { appState, subscribedRoom } = useAppSelector(state => ({
		subscribedRoom: state.room.subscribedRoom,
		appState: state.app.ready && state.app.foreground ? 'foreground' : 'background'
	}));

	const show = (
		notification: INotifierComponent['notification'] & {
			customComponent?: ElementType;
			customTime?: number;
			customNotification?: boolean;
			hideOnPress?: boolean;
			swipeEnabled?: boolean;
		}
	) => {
		if (appState !== 'foreground') return;

		const { payload } = notification;
		const state = Navigation.navigationRef.current?.getRootState();
		const route = getActiveRoute(state);
		if (payload?.rid || notification.customNotification) {
			if (route?.name === 'JitsiMeetView' || payload?.message?.t === 'videoconf') return;

			if (payload?.rid === subscribedRoom) {
				const notificationInAppVibration = userPreferences.getBool(NOTIFICATION_IN_APP_VIBRATION);
				if (notificationInAppVibration || notificationInAppVibration === null) {
					Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
				}
				return;
			}

			Notifier.showNotification({
				showEasing: Easing.inOut(Easing.quad),
				Component: notification.customComponent || NotifierComponent,
				componentProps: {
					notification
				},
				duration: notification.customTime || 3000, // default 3s,
				hideOnPress: notification.hideOnPress ?? true,
				swipeEnabled: notification.swipeEnabled ?? true
			});
		}
	};

	useEffect(() => {
		const listener = EventEmitter.addEventListener(INAPP_NOTIFICATION_EMITTER, show);
		return () => {
			EventEmitter.removeListener(INAPP_NOTIFICATION_EMITTER, listener);
		};
	}, [subscribedRoom, appState]);

	return <NotifierRoot />;
});

export default InAppNotification;
