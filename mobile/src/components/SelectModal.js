import { StatusBar } from 'expo-status-bar'
import { useMemo, useState } from 'react'
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { fuzzyFilter } from '../lib/fuzzy'
import { C } from './ui'

/**
 * Full-screen list to pick one item, with typo-tolerant search.
 * items need an `id`; getText gives the searchable text; renderItem how a row looks.
 */
export default function SelectModal({
  visible,
  title,
  items,
  onSelect,
  onClose,
  getText = (x) => x.name,
  renderItem,
  searchable = true,
  placeholder = 'Type to search…',
  emptyText = 'No match',
  selectedId,
}) {
  const [query, setQuery] = useState('')
  const results = useMemo(() => fuzzyFilter(items || [], query, getText), [items, query, getText])

  const close = () => {
    setQuery('')
    onClose()
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={m.wrap}>
        <StatusBar style="dark" />
        <View style={m.head}>
          <Text style={m.title}>{title}</Text>
          <Pressable onPress={close} hitSlop={12} style={m.close}>
            <Text style={m.closeText}>Close</Text>
          </Pressable>
        </View>
        {searchable && (
          <TextInput
            testID="select-search"
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder={placeholder}
            placeholderTextColor="#9aa5b1"
            style={m.search}
            autoCorrect={false}
            autoCapitalize="none"
          />
        )}
        <FlatList
          data={results}
          keyExtractor={(x) => String(x.id)}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={m.empty}>{emptyText}</Text>}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                setQuery('')
                onSelect(item)
              }}
              style={({ pressed }) => [m.item, pressed && m.itemPressed, String(item.id) === String(selectedId) && m.itemOn]}
            >
              {renderItem ? renderItem(item) : <Text style={m.itemText}>{getText(item)}</Text>}
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Modal>
  )
}

const m = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#fff' },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  title: { fontSize: 18, fontWeight: '700', color: C.text, flex: 1 },
  close: { paddingVertical: 6, paddingHorizontal: 8 },
  closeText: { color: C.primary, fontSize: 16, fontWeight: '700' },
  search: {
    margin: 12,
    minHeight: 48,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 16,
    color: C.text,
  },
  item: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#eef1f4' },
  itemPressed: { backgroundColor: C.primarySoft },
  itemOn: { backgroundColor: '#f1f7ff' },
  itemText: { fontSize: 16, color: C.text },
  empty: { padding: 24, textAlign: 'center', color: C.muted, fontSize: 15 },
})
