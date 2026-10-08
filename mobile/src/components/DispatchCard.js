import { StyleSheet, Text, View } from 'react-native'
import { formatDate } from '../lib/format'
import { C, Card, Row } from './ui'

// One transporter's list: shops, boxes, carry bags, remarks.
export default function DispatchCard({ dispatch: d, showDate, actions }) {
  return (
    <Card>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={k.title} numberOfLines={2}>
          <Text style={{ fontWeight: '800' }}>{d.transporter_code}</Text> — {d.transporter_name}
        </Text>
        {showDate ? <Text style={k.date}>{formatDate(d.date)}</Text> : null}
      </Row>
      <View style={k.headRow}>
        <Text style={[k.head, { flex: 1 }]}>MEDICAL SHOP</Text>
        <Text style={[k.head, k.num]}>BOXES</Text>
        <Text style={[k.head, k.num]}>BAGS</Text>
      </View>
      {d.items.map((i) => (
        <View key={i.shop_id} style={k.item}>
          <View style={{ flex: 1 }}>
            <Text style={k.shop}>
              {i.shop_name}
              {i.shop_area ? <Text style={k.area}> — {i.shop_area}</Text> : null}
            </Text>
            {i.remarks ? <Text style={k.remark}>{i.remarks}</Text> : null}
          </View>
          <Text style={[k.qty, k.num]}>{i.boxes}</Text>
          <Text style={[k.qty, k.num]}>{i.carry_bags}</Text>
        </View>
      ))}
      <View style={k.totalRow}>
        <Text style={[k.total, { flex: 1 }]}>Total ({d.items.length} shops)</Text>
        <Text style={[k.total, k.num]}>{d.total_boxes}</Text>
        <Text style={[k.total, k.num]}>{d.total_bags}</Text>
      </View>
      {actions ? <Row>{actions}</Row> : null}
    </Card>
  )
}

const k = StyleSheet.create({
  title: { fontSize: 17, color: C.text, flex: 1 },
  date: { color: C.muted, fontWeight: '600' },
  headRow: { flexDirection: 'row', borderBottomWidth: 1.5, borderBottomColor: C.text, paddingBottom: 4 },
  head: { fontSize: 11, fontWeight: '700', color: C.muted, letterSpacing: 0.4 },
  num: { width: 56, textAlign: 'right' },
  item: { flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#eef1f4', alignItems: 'flex-start' },
  shop: { fontSize: 15, color: C.text },
  area: { color: C.muted },
  remark: { fontSize: 14, fontWeight: '700', color: C.warn, marginTop: 2 },
  qty: { fontSize: 16, color: C.text },
  totalRow: { flexDirection: 'row', paddingTop: 6 },
  total: { fontSize: 16, fontWeight: '800', color: C.text },
})
