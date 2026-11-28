import { useRef, useState } from 'react';
import { router, type Href } from 'expo-router';
import { AppText, Button, Callout, Field, Row, Screen, type TextInputRef } from '@/components/ui';
import { BrandMark, EMAIL_RE, ServerFootnote } from '@/components/auth/AuthChrome';
import { errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function SignIn() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const pwRef = useRef<TextInputRef>(null);

  const submit = async () => {
    const e: typeof errors = {};
    if (!EMAIL_RE.test(email.trim())) e.email = 'Enter a valid email';
    if (!password) e.password = 'Enter your password';
    setErrors(e);
    setServerError(null);
    if (e.email || e.password) return;
    try {
      await signIn(email, password);
      // The auth gate in app/_layout.tsx moves on to setup or the tabs.
    } catch (err) {
      setServerError(errorMessage(err));
    }
  };

  return (
    <Screen safeTop testID="sign-in-screen">
      <BrandMark />
      <AppText variant="largeTitle" accessibilityRole="header">Sign in</AppText>
      <AppText tone="muted" style={{ marginTop: 4, marginBottom: 24 }}>
        A shared, neutral record for co-parents: schedule, costs, messages and calls.
      </AppText>

      <Field
        label="Email"
        value={email}
        onChangeText={(v) => { setEmail(v); if (errors.email) setErrors({ ...errors, email: undefined }); }}
        error={errors.email}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => pwRef.current?.focus()}
        testID="email"
      />
      <Field
        ref={pwRef}
        label="Password"
        value={password}
        onChangeText={(v) => { setPassword(v); if (errors.password) setErrors({ ...errors, password: undefined }); }}
        error={errors.password}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
        testID="password"
      />

      {serverError ? <Callout tone="bad">{serverError}</Callout> : null}
      <Button title="Sign in" variant="primary" block onPress={submit} testID="sign-in-submit" />

      <Row justify="center" style={{ marginTop: 20 }} gap={6}>
        <AppText tone="muted">New here?</AppText>
        <Button title="Create an account" variant="link" onPress={() => router.push('/sign-up' as Href)} testID="go-sign-up" />
      </Row>
      <ServerFootnote />
    </Screen>
  );
}
