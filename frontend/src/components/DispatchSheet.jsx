import { formatDate } from '../api.js'

// One transporter's list for one day: shops, boxes, carry bags and remarks.
// onPrint: send to the shop printer; onPrintHere: browser print dialog on this device.
export default function DispatchSheet({ dispatch, showDate = false, onPrint, onPrintHere, onEdit, className = '' }) {
  return (
    <div className={`sheet ${className}`}>
      <div className="sheet-head">
        <div>
          <b>{dispatch.transporter_code}</b> — {dispatch.transporter_name}
        </div>
        {showDate && <div>{formatDate(dispatch.date)}</div>}
        {(onEdit || onPrint || onPrintHere) && (
          <div className="sheet-actions no-print">
            {onEdit && (
              <button className="link" onClick={onEdit}>
                Edit
              </button>
            )}
            {onPrint && (
              <button className="link" onClick={onPrint} title="Print on the shop printer">
                Print
              </button>
            )}
            {onPrintHere && (
              <button className="link muted-link" onClick={onPrintHere} title="Print from this device (browser print dialog)">
                Print here
              </button>
            )}
          </div>
        )}
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Medical shop</th>
            <th className="num">Boxes</th>
            <th className="num">Bags</th>
          </tr>
        </thead>
        <tbody>
          {dispatch.items.map((i, idx) => (
            <tr key={i.shop_id}>
              <td>{idx + 1}</td>
              <td>
                {i.shop_name}
                {i.shop_area && <span className="muted"> — {i.shop_area}</span>}
                {i.remarks && <div className="remark">{i.remarks}</div>}
              </td>
              <td className="num">{i.boxes}</td>
              <td className="num">{i.carry_bags}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td></td>
            <td>Total ({dispatch.items.length} shops)</td>
            <td className="num total">{dispatch.total_boxes}</td>
            <td className="num total">{dispatch.total_bags}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
