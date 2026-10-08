import { Alert } from 'react-native'

// Promise-based yes/no dialog.
export function confirm(title, message, { ok = 'OK', cancel = 'Cancel', destructive = false } = {}) {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancel, style: 'cancel', onPress: () => resolve(false) },
      { text: ok, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) })
  })
}
