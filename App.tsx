import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useEffect, useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import {
  NavigationContainer,
  DarkTheme,
  DefaultTheme,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Font from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { initDb, reconcileOrphanedMediaFiles } from './src/database/schema';
import { QualityProvider } from './src/theme/quality';
import type { RootStackParamList } from './src/types/navigation';
import { AppText } from './src/components/AppText';
import { FoldersScreen } from './src/screens/FoldersScreen';
import { NotesListScreen } from './src/screens/NotesListScreen';
import { NoteEditorScreen } from './src/screens/NoteEditorScreen';
import {
  ShareIntentProvider,
  useShareIntentContext,
} from 'expo-share-intent';
import { ShareImportScreen } from './src/screens/ShareImportScreen';
import { StorageUsageScreen } from './src/screens/StorageUsageScreen';
import { BackupScreen } from './src/screens/BackupScreen';
import { LanguageProvider, useLanguage } from './src/i18n/LanguageContext';
import { recoverInterruptedFullReplacement } from './src/services/archive';
import { installAutomaticBackupCatchUp } from './src/services/automaticBackup';
import { initializeBackupDiscovery } from './src/services/backupDiscovery';
import { finishBackupNotification } from './src/services/backupFolder';
import { resumePendingBackupOperation } from './src/services/backupBackground';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

const AppNavigator = () => {
  const [isReady, setIsReady] = useState(false);
  const [isNavReady, setIsNavReady] = useState(false);
  const [hasSetupError, setHasSetupError] = useState(false);
  const { isDark, colors } = useTheme();
  const { hasShareIntent, shareIntent, isReady: isShareReady } = useShareIntentContext();
  const { t, isLanguageReady } = useLanguage();
  const sharedFiles = useMemo(() => shareIntent.files ?? [], [shareIntent.files]);

  useEffect(() => {
    async function setup() {
      try {
        const loadFonts = Font.loadAsync({
          'NotoSansBengali': require('./assets/fonts/NotoSansBengali-Regular.ttf'),
          'NotoSansBengali-SemiBold': require('./assets/fonts/NotoSansBengali-SemiBold.ttf'),
        });
        const initializeDatabase = async () => {
          if (Platform.OS === 'android') await recoverInterruptedFullReplacement();
          await initDb();
          void reconcileOrphanedMediaFiles();
        };
        await Promise.all([loadFonts, initializeDatabase()]);
        setHasSetupError(false);
      } catch (e) {
        console.warn('Error during setup:', e);
        setHasSetupError(true);
      } finally {
        setIsReady(true);
      }
    }
    setup();
  }, []);

  useEffect(() => {
    if (!isReady || hasSetupError) return;
    let cancelled = false;
    let uninstallAutomaticCatchUp: (() => void) | null = null;

    // Discovery and durable-operation recovery both touch the same Drive and
    // operation state.  Complete them in a deterministic order before
    // installing the AppState catch-up listener; otherwise a due automatic
    // attempt can race recovery during a cold start and observe a stale
    // operation row or half-populated discovery cache.
    const bootstrapBackupRuntime = async () => {
      try {
        await initializeBackupDiscovery();
      } catch (error: unknown) {
        console.warn('Initial backup discovery failed:', error);
      }
      try {
        const operation = await resumePendingBackupOperation();
        if (!cancelled && operation && Platform.OS === 'android') {
          finishBackupNotification(operation.state === 'succeeded');
        }
      } catch (error: unknown) {
        console.warn('Pending backup recovery failed:', error);
        if (!cancelled && Platform.OS === 'android') finishBackupNotification(false);
      }
      if (!cancelled) uninstallAutomaticCatchUp = installAutomaticBackupCatchUp();
    };
    void bootstrapBackupRuntime();
    return () => {
      cancelled = true;
      uninstallAutomaticCatchUp?.();
    };
  }, [hasSetupError, isReady]);

  useEffect(() => {
    if (!isNavReady || !isShareReady || !hasShareIntent || sharedFiles.length === 0) {
      return;
    }

    if (navigationRef.getCurrentRoute()?.name === 'ShareImport') {
      return;
    }

    navigationRef.navigate('ShareImport', {
      sharedFiles: sharedFiles.map((file) => ({
        path: file.path,
        fileName: file.fileName,
        mimeType: file.mimeType,
      })),
    });
  }, [hasShareIntent, isNavReady, isShareReady, sharedFiles]);

  if (!isReady || !isLanguageReady) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.background,
        }}
      >
        <AppText variant="bodySmall" color={colors.textSecondary}>
          {t('app.loading')}
        </AppText>
      </View>
    );
  }

  if (hasSetupError) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 24,
          backgroundColor: colors.background,
        }}
      >
        <AppText
          variant="headline"
          color={colors.error}
          style={{ textAlign: 'center' }}
        >
          {t('app.dbSetupError')}
        </AppText>
      </View>
    );
  }

  const baseTheme = isDark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      notification: colors.primaryBright,
    },
  };

  return (
    <SafeAreaProvider>
      <NavigationContainer ref={navigationRef} theme={navTheme} onReady={() => setIsNavReady(true)}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <Stack.Navigator
          initialRouteName="Folders"
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="ShareImport" component={ShareImportScreen} />
          <Stack.Screen name="Folders" component={FoldersScreen} />
          <Stack.Screen name="StorageUsage" component={StorageUsageScreen} />
          <Stack.Screen name="Backup" component={BackupScreen} />
          <Stack.Screen name="NotesList" component={NotesListScreen} />
          <Stack.Screen name="NoteEditor" component={NoteEditorScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
};

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ShareIntentProvider>
        <LanguageProvider>
          <ThemeProvider>
            <QualityProvider>
              <AppNavigator />
            </QualityProvider>
          </ThemeProvider>
        </LanguageProvider>
      </ShareIntentProvider>
    </GestureHandlerRootView>
  );
}
