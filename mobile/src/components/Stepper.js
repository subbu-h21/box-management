import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { C } from './ui'

// Whole number with big − / + buttons. Empty counts as 0.
export default function Stepper({ value, onChange, min = 0, max = 10000, label, testID }) {
  const n = parseInt(value, 10)
  const current = Number.isNaN(n) ? 0 : n
  const step = (d) => onChange(String(Math.min(max, Math.max(min, current + d))))
  return (
    <View style={st.wrap}>
      {label ? <Text style={st.label}>{label}</Text> : null}
      <View style={st.box}>
        <Pressable
          accessibilityLabel={`Decrease ${label || ''}`}
          onPress={() => step(-1)}
          disabled={current <= min}
          style={({ pressed }) => [st.btn, pressed && st.pressed, current <= min && st.disabled]}
        >
          <Text style={st.btnText}>−</Text>
        </Pressable>
        <TextInput
          testID={testID}
          accessibilityLabel={label}
          style={st.input}
          keyboardType="number-pad"
          selectTextOnFocus
          placeholder="0"
          placeholderTextColor="#9aa5b1"
          value={String(value ?? '')}
          onChangeText={(t) => onChange(t.replace(/[^0-9]/g, '').slice(0, 5))}
        />
        <Pressable
          accessibilityLabel={`Increase ${label || ''}`}
          onPress={() => step(1)}
          disabled={current >= max}
          style={({ pressed }) => [st.btn, pressed && st.pressed, current >= max && st.disabled]}
        >
          <Text style={st.btnText}>+</Text>
        </Pressable>
      </View>
    </View>
  )
}

const st = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 13, fontWeight: '700', color: C.muted },
  box: { flexDirection: 'row', borderWidth: 1, borderColor: C.border, borderRadius: 10, overflow: 'hidden', alignSelf: 'flex-start' },
  btn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f4f8' },
  pressed: { backgroundColor: '#dfe9f6' },
  disabled: { opacity: 0.35 },
  btnText: { fontSize: 24, fontWeight: '700', color: C.primaryDark },
  input: {
    width: 64,
    height: 48,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '600',
    color: C.text,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: C.border,
    backgroundColor: '#fff',
  },
})
