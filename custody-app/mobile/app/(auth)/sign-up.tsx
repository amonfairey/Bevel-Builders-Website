import { useRef, useState } from 'react';
import { router, type Href } from 'expo-router';
import { AppText, Button, Callout, Field, Row, Screen, type TextInputRef } from '@/components/ui';
import { BrandMark, EMAIL_RE, MIN_PASSWORD, ServerFootnote } from '@/components/auth/AuthChrome';
import { errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';

type Errors = { name?: string; email?: string; password?: string };

export default function SignUp() {
  const { signUp } = useSession();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const emailRef = useRef<TextInputRef>(null);
  const pwRef = useRef<TextInputRef>(null);

  const clear = (k: keyof Errors) => { if (errors[k]) setErrors({ ...errors, [k]: undefined }); };

  const submit = async () => {
    // Same rules and wording as the server (POST /api/register).
    const e: Errors = {};
    if (!EMAIL_RE.test(email.trim())) e.email = 'Enter a valid email';
    if (!name.trim()) e.name = 'Enter your name';
    if (password.length < MIN_PASSWORD) e.password = `Password must be at least ${MIN_PASSWORD} characters`;
    setErrors(e);
    setServerError(null);
    if (e.email || e.name || e.password) return;
    try {
      await signUp(name, email, password);
    } catch (err) {
      setServerError(errorMessage(err));
    }
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace('/sign-in' as Href));

  return (
    <Screen safeTop testID="sign-up-screen">
      <BrandMark />
      <AppText variant="largeTitle" accessibilityRole="header">Create your account</AppText>
      <AppText tone="muted" style={{ marginTop: 4, marginBottom: 24 }}>
        After this you can start a family space or join the one your co-parent created.
      </AppText>

      <Field
        label="Your name"
        value={name}
        onChangeText={(v) => { setName(v); clear('name'); }}
        error={errors.name}
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
        onSubmitEditing={() => emailRef.current?.focus()}
        testID="name"
      />
      <Field
        ref={emailRef}
        label="Email"
        value={email}
        onChangeText={(v) => { setEmail(v); clear('email'); }}
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
        onChangeText={(v) => { setPassword(v); clear('password'); }}
        error={errors.password}
        hint={`At least ${MIN_PASSWORD} characters.`}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={submit}
        testID="password"
      />

      {serverError ? <Callout tone="bad">{serverError}</Callout> : null}
      <Button title="Create account" variant="primary" block onPress={submit} testID="sign-up-submit" />

      <Row justify="center" style={{ marginTop: 20 }} gap={6}>
        <AppText tone="muted">Have an account?</AppText>
        <Button title="Sign in" variant="link" onPress={back} testID="go-sign-in" />
      </Row>
      <ServerFootnote />
    </Screen>
  );
}
