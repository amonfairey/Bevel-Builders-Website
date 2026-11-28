# CoParent Hub iPhone app: notes for coding agents

Expo (React Native) app, TypeScript strict, Expo Router. Read `README.md` first: it has the
route ownership table, conventions and commands.

## Expo has changed: do not trust your training data

Expo SDK 58 / React Native 0.88 / React 19.3 are newer than most training data. Before using
an Expo, EAS or React Native API, read the installed type definitions in `node_modules`
(for example `node_modules/expo-router/build/*.d.ts`) or the versioned docs at
`https://docs.expo.dev/versions/v58.0.0/`. Notable: import tabs from `expo-router/js-tabs`
(the `Tabs` export of `expo-router` is deprecated), the auth gate uses `Stack.Protected`,
layouts set `unstable_settings.anchor` (not `initialRouteName`), notification handlers
return `shouldShowBanner` / `shouldShowList`, and TypeScript 6 no longer auto-includes
`@types/node` (tests have their own `lib/__tests__/tsconfig.json`).

## Layout

- Routes live in `app/` (not `src/app/`). Every file there is a screen; `_layout.tsx` files define navigators.
- Every route must also be declared inside the matching `Stack.Protected` group in `app/_layout.tsx`, or it bypasses the auth gate.
- Non-route code lives outside `app/`: shared code in `lib/` and `components/ui/` (foundation-owned), area code in `components/<area>/`.

## Commands

```bash
npx expo install <package>   # instead of npm install, resolves SDK-compatible versions
                             # (prefix EXPO_OFFLINE=1 if api.expo.dev is unreachable)
npm run typecheck            # tsc --noEmit for app + tests
npm test                     # unit tests (plain Node)
npx expo export --platform web --output-dir /tmp/coparent-web   # full bundle check; never commit dist/
npx expo start               # dev server (Expo Go / dev build); --web for the browser preview
```

Run the typecheck, the tests and a web export before declaring a task done.

## Rules

- `ios/` and `android/` are generated (Continuous Native Generation). Never create or edit them; configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. A new native library needs a development build (`eas build --profile development`).
- Prefer Expo modules over third-party libraries.
- Use `useDialog()` for confirmations, never `Alert.alert` (it is a no-op in the web preview).
- Show custody times in the family time zone with `lib/format.ts`, never the device zone.
