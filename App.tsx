import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useEffect, useMemo, useState } from 'react';
import { View, Text, useColorScheme } from 'react-native';
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
import { initDb } from './src/database/schema';
import { getThemeColors } from './src/theme/colors';
import type { RootStackParamList } from './src/types/navigation';
import { FoldersScreen } from './src/screens/FoldersScreen';
import { NotesListScreen } from './src/screens/NotesListScreen';
import { NoteEditorScreen } from './src/screens/NoteEditorScreen';
import {
  ShareIntentProvider,
  useShareIntentContext,
} from 'expo-share-intent';
import { ShareImportScreen } from './src/screens/ShareImportScreen';
import { StorageUsageScreen } from './src/screens/StorageUsageScreen';
import { LanguageProvider, useLanguage } from './src/i18n/LanguageContext';

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

const AppNavigator = () => {
  const [isReady, setIsReady] = useState(false);
  const [isNavReady, setIsNavReady] = useState(false);
  const [hasSetupError, setHasSetupError] = useState(false);
  const isDark = useColorScheme() === 'dark';
  const colors = getThemeColors(isDark);
  const { hasShareIntent, shareIntent, isReady: isShareReady } = useShareIntentContext();
  const { t, isLanguageReady } = useLanguage();
  const sharedFiles = useMemo(() => shareIntent.files ?? [], [shareIntent.files]);

  useEffect(() => {
    async function setup() {
      try {
        await Font.loadAsync({
          'NotoSansBengali': require('./assets/fonts/NotoSansBengali-Regular.ttf'),
        });
        await initDb();
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
        <Text style={{ color: colors.textSecondary, fontFamily: 'NotoSansBengali' }}>
          {t('app.loading')}
        </Text>
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
        <Text
          style={{
            color: colors.error,
            fontFamily: 'NotoSansBengali',
            fontSize: 18,
            textAlign: 'center',
            lineHeight: 28,
          }}
        >
          {t('app.dbSetupError')}
        </Text>
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
      card: colors.card,
      text: colors.text,
      border: colors.border,
      notification: colors.accent,
    },
  };

  return (
    <SafeAreaProvider>
      <NavigationContainer ref={navigationRef} theme={navTheme} onReady={() => setIsNavReady(true)}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <Stack.Navigator
          initialRouteName="Folders"
          screenOptions={{
            headerStyle: { backgroundColor: colors.card },
            headerTintColor: colors.primary,
            headerTitleStyle: { fontFamily: 'NotoSansBengali' },
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen
            name="ShareImport"
            component={ShareImportScreen}
            options={{ title: t('header.shareImport') }}
          />
          <Stack.Screen
            name="Folders"
            component={FoldersScreen}
            options={{ title: t('header.folders') }}
          />
          <Stack.Screen
            name="StorageUsage"
            component={StorageUsageScreen}
            options={{ title: t('header.storageUsage') }}
          />
          <Stack.Screen
            name="NotesList"
            component={NotesListScreen}
            options={{ title: t('header.notes') }}
          />
          <Stack.Screen
            name="NoteEditor"
            component={NoteEditorScreen}
            options={{ title: t('header.noteEditor') }}
          />
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
          <AppNavigator />
        </LanguageProvider>
      </ShareIntentProvider>
    </GestureHandlerRootView>
  );
}
