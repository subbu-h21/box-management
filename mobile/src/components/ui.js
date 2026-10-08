import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export const C = {
  bg: '#f4f6f8',
  card: '#ffffff',
  text: '#1f2933',
  muted: '#6b7785',
  border: '#d9dee3',
  primary: '#1565c0',
  primaryDark: '#0d47a1',
  primarySoft: '#e3f2fd',
  danger: '#c62828',
  dangerSoft: '#ffebee',
  success: '#2e7d32',
  successSoft: '#e8f5e9',
  warn: '#8a4b00',
  warnSoft: '#fff8e1',
}

// Scrollable page with optional pull-to-refresh. Tabs already handle the bottom inset.
export function Screen({ children, onRefresh, refreshing = false, edges = ['left', 'right'], scroll = true, style }) {
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[s.screenContent, style]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[s.screenContent, { flex: 1 }, style]}>{children}</View>
  )
  return (
    <SafeAreaView style={s.screen} edges={edges}>
      {content}
    </SafeAreaView>
  )
}

export const Card = ({ children, style }) => <View style={[s.card, style]}>{children}</View>
export const H1 = ({ children, style }) => <Text style={[s.h1, style]}>{children}</Text>
export const H2 = ({ children, style }) => <Text style={[s.h2, style]}>{children}</Text>
export const Muted = ({ children, style, ...p }) => (
  <Text style={[s.muted, style]} {...p}>
    {children}
  </Text>
)
export const Row = ({ children, style }) => <View style={[s.row, style]}>{children}</View>

export function Button({ title, onPress, variant = 'primary', disabled, loading, style, small, testID }) {
  const v = BUTTON[variant]
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(disabled || loading) }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        s.btn,
        small && s.btnSmall,
        v.box,
        pressed && !disabled && { opacity: 0.75 },
        (disabled || loading) && { opacity: 0.45 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.text.color} />
      ) : (
        <Text style={[s.btnText, small && s.btnTextSmall, v.text]}>{title}</Text>
      )}
    </Pressable>
  )
}

const BUTTON = {
  primary: { box: { backgroundColor: C.primary }, text: { color: '#fff' } },
  secondary: { box: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: C.primary }, text: { color: C.primary } },
  danger: { box: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: C.danger }, text: { color: C.danger } },
  link: { box: { backgroundColor: 'transparent', paddingHorizontal: 6 }, text: { color: C.primary } },
  dangerLink: { box: { backgroundColor: 'transparent', paddingHorizontal: 6 }, text: { color: C.danger } },
}

export function Field({ label, hint, style, ...input }) {
  return (
    <View style={[s.field, style]}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <TextInput placeholderTextColor="#9aa5b1" style={s.input} {...input} />
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  )
}

export const Label = ({ children }) => <Text style={s.label}>{children}</Text>

const BANNER = {
  error: { box: { backgroundColor: C.dangerSoft, borderColor: '#ef9a9a' }, text: { color: C.danger } },
  success: { box: { backgroundColor: C.successSoft, borderColor: '#a5d6a7' }, text: { color: C.success } },
  notice: { box: { backgroundColor: C.warnSoft, borderColor: '#ffe082' }, text: { color: C.text } },
  info: { box: { backgroundColor: C.primarySoft, borderColor: '#90caf9' }, text: { color: C.primaryDark } },
}

export function Banner({ type = 'notice', children, style, right }) {
  if (!children) return null
  const b = BANNER[type]
  return (
    <View style={[s.banner, b.box, style]}>
      <Text style={[s.bannerText, b.text]}>{children}</Text>
      {right}
    </View>
  )
}

export function Badge({ children, tone = 'neutral' }) {
  const t = {
    neutral: ['#eceff1', '#455a64'],
    admin: ['#ede7f6', '#4527a0'],
    ok: [C.successSoft, C.success],
    bad: [C.dangerSoft, C.danger],
    info: [C.primarySoft, C.primaryDark],
    warn: [C.warnSoft, C.warn],
  }[tone]
  return (
    <View style={[s.badge, { backgroundColor: t[0] }]}>
      <Text style={[s.badgeText, { color: t[1] }]}>{String(children).toUpperCase()}</Text>
    </View>
  )
}

// Tap row that opens something (a picker, a screen).
export function SelectRow({ label, value, placeholder, onPress, testID }) {
  return (
    <View style={s.field}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [s.input, s.selectRow, pressed && { backgroundColor: '#f5f9ff' }]}>
        <Text style={[s.selectText, !value && { color: '#9aa5b1' }]} numberOfLines={2}>
          {value || placeholder}
        </Text>
        <Text style={s.chevron}>▾</Text>
      </Pressable>
    </View>
  )
}

export function Segmented({ options, value, onChange }) {
  return (
    <View style={s.segmented}>
      {options.map((o, i) => (
        <Pressable
          key={o.value}
          onPress={() => onChange(o.value)}
          style={[s.segment, i > 0 && s.segmentBorder, value === o.value && s.segmentOn]}
        >
          <Text style={[s.segmentText, value === o.value && s.segmentTextOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  )
}

export const Loading = () => (
  <View style={{ padding: 40, alignItems: 'center' }}>
    <ActivityIndicator size="large" color={C.primary} />
  </View>
)

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  screenContent: { padding: 14, paddingBottom: 32, gap: 12 },
  card: { backgroundColor: C.card, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, gap: 10 },
  h1: { fontSize: 22, fontWeight: '700', color: C.text },
  h2: { fontSize: 18, fontWeight: '700', color: C.text },
  muted: { color: C.muted, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  btn: { minHeight: 48, borderRadius: 10, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  btnSmall: { minHeight: 38, paddingHorizontal: 12, borderRadius: 8 },
  btnText: { fontSize: 16, fontWeight: '700' },
  btnTextSmall: { fontSize: 14 },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '700', color: C.muted },
  hint: { fontSize: 12, color: C.muted },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 16,
    color: C.text,
    backgroundColor: '#fff',
  },
  selectRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  selectText: { flex: 1, fontSize: 16, color: C.text, paddingVertical: 10 },
  chevron: { fontSize: 16, color: C.muted },
  banner: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 8 },
  bannerText: { fontSize: 15, fontWeight: '600' },
  badge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start' },
  badgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4 },
  segmented: { flexDirection: 'row', borderWidth: 1, borderColor: C.border, borderRadius: 10, overflow: 'hidden' },
  segment: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  segmentBorder: { borderLeftWidth: 1, borderLeftColor: C.border },
  segmentOn: { backgroundColor: C.primary },
  segmentText: { fontSize: 15, color: C.text, fontWeight: '600' },
  segmentTextOn: { color: '#fff' },
})
