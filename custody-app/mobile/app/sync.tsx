import { useState } from 'react';
import { Pressable, View } from 'react-native';
import * as Linking from 'expo-linking';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AppText, Button, ButtonRow, Callout, Card, Screen, Section, useAttempt, useDialog, useToast } from '@/components/ui';
import { CopyRow } from '@/components/settings/CopyRow';
import { FeedsSection } from '@/components/settings/FeedsSection';
import { api } from '@/lib/api';
import { absoluteUrl } from '@/lib/config';
import { useMe } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import type { OkResponse } from '@/lib/types';

const toWebcal = (url: string) => url.replace(/^https?:/i, 'webcal:');

function Step({ n, children }: { n: number; children: string }) {
  return (
    <View style={{ flexDirection: 'row', marginBottom: 6 }}>
      <AppText variant="subhead" weight="600" style={{ width: 22 }}>{`${n}.`}</AppText>
      <AppText variant="subhead" style={{ flex: 1 }}>{children}</AppText>
    </View>
  );
}

/**
 * Calendar sync (web portal VIEWS.sync): this user's private subscription addresses with
 * one-tap "Add to iPhone Calendar" (webcal://), Google and Outlook links, instructions and
 * reset; plus importing other calendars. Viewers can use all of it: it is about their own calendar.
 */
export default function SyncScreen() {
  const me = useMe();
  const t = useTheme();
  const toast = useToast();
  const attempt = useAttempt();
  const dialog = useDialog();
  const { refreshMe } = useSession();
  const [howOpen, setHowOpen] = useState(false);

  const base = absoluteUrl(me.icsBase);
  const custody = `${base}?include=custody`;
  const events = `${base}?include=events`;
  const insecure = !/^https:/i.test(base);

  const open = async (url: string, what: string) => {
    try { await Linking.openURL(url); } catch { toast.show(`Could not open ${what}. Copy the address and add it by hand (see the steps below).`, { tone: 'bad' }); }
  };
  const subscribe = (url: string) => open(toWebcal(url), 'Calendar');

  const reset = async () => {
    const ok = await dialog.confirm({
      title: 'Reset your private address?',
      message: 'Old subscriptions stop updating. You will need to add the new address to your calendars again.',
      okLabel: 'Reset address',
      destructive: true,
    });
    if (!ok) return;
    if (await attempt(() => api.post<OkResponse>('/api/ics-token/rotate'), 'New private address created')) {
      try { await refreshMe(); } catch { /* the toast above already confirmed; pull to refresh retries */ }
    }
  };

  return (
    <Screen headerTitle="Calendar sync" testID="sync-screen">
      <AppText variant="subhead" tone="muted" style={{ marginBottom: 16 }}>
        See custody time and activities in Apple Calendar, Google Calendar or Outlook through a standard calendar subscription, and bring your other calendars in to spot conflicts.
      </AppText>

      <Section title="Show the schedule in your calendar">
        <Card>
          <AppText variant="subhead" tone="muted" style={{ marginBottom: 12 }}>
            These are your personal private addresses. Anyone with one can see your schedule, so don&apos;t share them. Your co-parent has their own.
          </AppText>
          {insecure ? (
            <Callout tone="warn">This server is not on HTTPS, so iPhone, Google and Outlook calendars may refuse to subscribe. Use your deployed https:// server for calendar sync.</Callout>
          ) : null}
          <Button title="Add to iPhone Calendar" icon="calendar" variant="primary" block onPress={() => subscribe(base)} testID="sync-add-iphone" />
          <AppText variant="footnote" tone="muted" style={{ marginTop: 6, marginBottom: 12 }}>Opens Calendar with &quot;Subscribe&quot;: custody blocks and activities, kept up to date automatically.</AppText>
          <ButtonRow style={{ marginTop: 0, marginBottom: 16 }}>
            <Button title="Add to Google Calendar" icon="logo-google" size="sm" onPress={() => open(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(toWebcal(base))}`, 'Google Calendar')} testID="sync-google" />
            <Button title="Add to Outlook" icon="mail-outline" size="sm" onPress={() => open(`https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(base)}&name=${encodeURIComponent('Co-parenting')}`, 'Outlook')} testID="sync-outlook" />
          </ButtonRow>

          <CopyRow label="Everything (custody blocks + activities)" value={base} testID="sync-url-all" />
          <CopyRow label="Custody blocks only" value={custody} testID="sync-url-custody">
            <Button title="Subscribe" icon="calendar-outline" size="sm" onPress={() => subscribe(custody)} />
          </CopyRow>
          <CopyRow label="Activities only" value={events} testID="sync-url-events">
            <Button title="Subscribe" icon="calendar-outline" size="sm" onPress={() => subscribe(events)} />
          </CopyRow>

          <Pressable
            onPress={() => setHowOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: howOpen }}
            style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44 }}
            testID="sync-howto"
          >
            <Ionicons name={howOpen ? 'chevron-down' : 'chevron-forward'} size={18} color={t.colors.accent} />
            <AppText weight="500" tone="accent" style={{ marginLeft: 6 }}>Step-by-step instructions</AppText>
          </Pressable>
          {howOpen ? (
            <View style={{ marginTop: 4 }}>
              <AppText variant="subhead" weight="600" style={{ marginBottom: 6 }}>iPhone (Apple Calendar)</AppText>
              <Step n={1}>Tap &quot;Add to iPhone Calendar&quot; (or &quot;Subscribe&quot; next to one of the addresses).</Step>
              <Step n={2}>Calendar asks to subscribe: tap Subscribe, pick the account (iCloud keeps it on your Mac and iPad too), then Add.</Step>
              <Step n={3}>If nothing happens: copy an address, then open Settings → Apps → Calendar → Calendar Accounts (older iOS: Settings → Calendar → Accounts) → Add Account → Other → Add Subscribed Calendar, and paste it.</Step>
              <AppText variant="subhead" weight="600" style={{ marginTop: 10, marginBottom: 6 }}>Mac</AppText>
              <Step n={1}>Calendar → File → New Calendar Subscription → paste an address.</Step>
              <AppText variant="subhead" weight="600" style={{ marginTop: 10, marginBottom: 6 }}>Google Calendar</AppText>
              <Step n={1}>Tap &quot;Add to Google Calendar&quot;, or on a computer open calendar.google.com → Other calendars + → From URL → paste an address.</Step>
              <Step n={2}>Google refreshes subscriptions every few hours (Google controls this).</Step>
              <AppText variant="subhead" weight="600" style={{ marginTop: 10, marginBottom: 6 }}>Outlook</AppText>
              <Step n={1}>Tap &quot;Add to Outlook&quot;, or in Outlook.com / new Outlook → Add calendar → Subscribe from web → paste an address.</Step>
            </View>
          ) : null}

          <Button title="Reset private address" variant="danger" size="sm" onPress={reset} style={{ marginTop: 12 }} testID="sync-reset" />
        </Card>
      </Section>

      <FeedsSection />
    </Screen>
  );
}
