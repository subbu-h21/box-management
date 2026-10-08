import { useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import { ChoosePrinter, PrinterStatus, PrintJobs, usePrintQueue } from '../../components/PrintQueue'
import SelectModal from '../../components/SelectModal'
import Stepper from '../../components/Stepper'
import { Banner, Button, C, Card, Muted, Screen, SelectRow } from '../../components/ui'
import { api } from '../../lib/api'
import { shopLabel } from '../../lib/format'

const sampleSticker = require('../../../assets/glass-sticker.jpg')
const PT_TO_MM = 25.4 / 72

export default function StickersScreen() {
  const queue = usePrintQueue()
  const [shops, setShops] = useState([])
  const [settings, setSettings] = useState(null)
  const [shopId, setShopId] = useState('')
  const [copies, setCopies] = useState('1')
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      const [sh, st] = await Promise.all([api.listShops(), api.stickerSettings()])
      setShops(sh)
      setSettings(st)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  // Layouts / sticker setup are edited on the website: refresh whenever this tab is opened.
  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  const shop = shops.find((s) => String(s.id) === shopId)
  const n = Math.max(1, Math.min(200, parseInt(copies, 10) || 1))
  const layout = settings && (shop?.sticker_layout || settings.default_layout)

  return (
    <Screen
      onRefresh={async () => {
        setRefreshing(true)
        await load()
        await queue.refresh()
        setRefreshing(false)
      }}
      refreshing={refreshing}
    >
      <Card>
        <PrinterStatus status={queue.status} use="stickers" />
        <SelectRow
          testID="sticker-shop"
          label='Medical shop (printed after "To,")'
          value={shop ? shopLabel(shop) : ''}
          placeholder="Choose medical shop"
          onPress={() => setPicking(true)}
        />
        <Stepper testID="copies" label="Copies" value={copies} min={1} max={200} onChange={setCopies} />
        <Button
          testID="print-stickers"
          title={`Print ${n} sticker${n > 1 ? 's' : ''}`}
          disabled={!shop}
          onPress={() => queue.submit(() => api.printStickers(shop.id, n))}
        />
        <Button
          variant="secondary"
          title="Alignment test (plain paper)"
          disabled={!shop}
          onPress={() => queue.submit(() => api.printStickerTest(shop.id))}
        />
        <PrintJobs queue={queue} />
        <Banner type="error">{error}</Banner>
      </Card>

      {settings && layout ? (
        <Card>
          <StickerPreview sticker={settings} layout={layout} text={shop?.name || 'Medical shop name'} />
          <Muted style={{ fontSize: 13 }}>
            Preview only — the name position and sticker setup are adjusted on the website (Stickers page).
            {shop?.sticker_layout ? ' This shop has its own layout.' : ''}
          </Muted>
        </Card>
      ) : null}

      <Card>
        <ChoosePrinter status={queue.status} use="stickers" onSaved={queue.refresh} />
      </Card>

      <SelectModal
        visible={picking}
        title="Choose medical shop"
        items={shops}
        getText={shopLabel}
        placeholder="Type to search medical shop…"
        emptyText="No matching shop"
        selectedId={shopId}
        onSelect={(s) => {
          setShopId(String(s.id))
          setPicking(false)
        }}
        onClose={() => setPicking(false)}
      />
    </Screen>
  )
}

// Sticker drawn to scale with the name where it will print (approximate; the website preview is exact).
function StickerPreview({ sticker, layout, text }) {
  const [width, setWidth] = useState(0)
  const scale = width / sticker.width_mm // px per mm
  const height = sticker.height_mm * scale
  const fontSize = layout.font_size_pt * PT_TO_MM * scale
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <View style={[p.sticker, { width, height }]}>
          <Image
            source={sticker.background ? { uri: sticker.background } : sampleSticker}
            style={StyleSheet.absoluteFill}
            resizeMode="stretch"
          />
          <View
            style={[
              p.box,
              {
                left: layout.x_mm * scale,
                top: layout.y_mm * scale,
                width: layout.width_mm * scale,
                height: layout.height_mm * scale,
                alignItems: { left: 'flex-start', center: 'center', right: 'flex-end' }[layout.align],
              },
            ]}
          >
            <Text
              numberOfLines={2}
              adjustsFontSizeToFit={layout.shrink_to_fit}
              minimumFontScale={0.15}
              style={{
                fontSize,
                lineHeight: fontSize * 1.15,
                fontWeight: layout.bold ? '700' : '400',
                color: '#000',
                textAlign: layout.align,
              }}
            >
              {text}
            </Text>
          </View>
        </View>
      ) : null}
      <Text style={p.caption}>
        {sticker.width_mm} × {sticker.height_mm} mm
      </Text>
    </View>
  )
}

const p = StyleSheet.create({
  sticker: { borderRadius: 4, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 1, borderColor: C.border },
  box: { position: 'absolute', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(21,101,192,0.7)' },
  caption: { textAlign: 'center', color: C.muted, fontSize: 12, marginTop: 6 },
})
