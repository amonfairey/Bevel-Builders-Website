import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { api } from '@/lib/api';
import { absoluteUrl } from '@/lib/config';
import type { ReportLink } from '@/lib/types';

/**
 * Open the printable report. Safari can't carry the app's bearer token, so the app first
 * gets a short-lived link (POST /api/report-link, valid 15 minutes) and opens API base + url:
 * in an in-app Safari view on iPhone, in a new tab in the web preview.
 *
 * Call it straight from the button press: in the web preview the tab is opened before the
 * request so the browser's pop-up blocker treats it as a user action.
 */
export async function openReport(start: string, end: string): Promise<void> {
  if (Platform.OS === 'web') {
    const tab = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    if (tab) tab.opener = null;
    try {
      const link = await api.post<ReportLink>('/api/report-link', { start, end });
      const url = absoluteUrl(link.url);
      if (tab) tab.location.href = url;
      else window.open(url, '_blank');
    } catch (e) {
      tab?.close();
      throw e;
    }
    return;
  }
  const link = await api.post<ReportLink>('/api/report-link', { start, end });
  await WebBrowser.openBrowserAsync(absoluteUrl(link.url), {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
    dismissButtonStyle: 'done',
  });
}
