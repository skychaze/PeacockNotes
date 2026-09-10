import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { Platform } from 'react-native';
import {
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';

export type Quality = {
  blurEnabled: boolean;
  ambientDrift: boolean;
  motionEnabled: boolean;
};

type Override = 'auto' | 'full' | 'reduced';

// Flip to 'reduced' or 'full' to test tiers manually.
export const QUALITY_OVERRIDE = 'auto' as Override;

const PROBE_KEY = 'ui.quality.probe.v1';

const isIOS = Platform.OS === 'ios';
const apiLevel = isIOS
  ? Number.MAX_SAFE_INTEGER
  : Number(Device.platformApiLevel ?? Platform.Version);
const yearClass = Device.deviceYearClass ?? Number.MAX_SAFE_INTEGER;
const totalMemory = Device.totalMemory ?? Number.MAX_SAFE_INTEGER;

const blurSupported = isIOS || apiLevel >= 31;
const specsHandleDrift = isIOS || yearClass >= 2019 || totalMemory >= 6 * 1024 ** 3;

const QualityContext = createContext<Quality>({
  blurEnabled: blurSupported,
  ambientDrift: specsHandleDrift,
  motionEnabled: true,
});

const useQualityProbe = (enabled: boolean, onDone: (reduced: boolean) => void) => {
  const slowFrames = useSharedValue(0);
  const totalFrames = useSharedValue(0);

  const frame = useFrameCallback((info) => {
    totalFrames.value += 1;
    if ((info.timeSincePreviousFrame ?? 0) > 32) {
      slowFrames.value += 1;
    }
  }, false);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    const startTimer = setTimeout(() => {
      frame.setActive(true);
      stopTimer = setTimeout(() => {
        frame.setActive(false);
        const sampled = totalFrames.value;
        const slowRatio = sampled > 0 ? slowFrames.value / sampled : 0;
        const reduced = sampled >= 120 && slowRatio > 0.15;
        AsyncStorage.setItem(PROBE_KEY, reduced ? 'reduced' : 'full').catch(() => {});
        onDone(reduced);
      }, 6000);
    }, 3000);

    return () => {
      clearTimeout(startTimer);
      if (stopTimer) {
        clearTimeout(stopTimer);
      }
      frame.setActive(false);
    };
  }, [enabled, frame, onDone, slowFrames, totalFrames]);
};

type ProbeResult = 'unknown' | 'full' | 'reduced';

export const QualityProvider = ({ children }: PropsWithChildren) => {
  const reduceMotion = useReducedMotion();
  const [probeResult, setProbeResult] = useState<ProbeResult>('unknown');

  useEffect(() => {
    AsyncStorage.getItem(PROBE_KEY)
      .then((value) => {
        if (value === 'reduced' || value === 'full') {
          setProbeResult(value);
        }
      })
      .catch(() => {});
  }, []);

  const handleProbeDone = useCallback((reduced: boolean) => {
    setProbeResult(reduced ? 'reduced' : 'full');
  }, []);

  const probeEnabled =
    probeResult === 'unknown' &&
    !__DEV__ &&
    Device.isDevice &&
    QUALITY_OVERRIDE === 'auto' &&
    specsHandleDrift;

  useQualityProbe(probeEnabled, handleProbeDone);

  const value = useMemo<Quality>(() => {
    const downgraded =
      QUALITY_OVERRIDE === 'reduced' ||
      (QUALITY_OVERRIDE === 'auto' && probeResult === 'reduced');
    return {
      blurEnabled: QUALITY_OVERRIDE === 'reduced' ? false : blurSupported,
      ambientDrift: specsHandleDrift && !downgraded && !reduceMotion,
      motionEnabled: QUALITY_OVERRIDE === 'reduced' ? false : !reduceMotion,
    };
  }, [probeResult, reduceMotion]);

  return <QualityContext.Provider value={value}>{children}</QualityContext.Provider>;
};

export const useQuality = () => useContext(QualityContext);
