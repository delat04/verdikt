// The verbs nextStep() returns, as buttons: one label and one icon each, everywhere they appear.
import { PenLine, Wallet, Send, Eye, UserPlus, MessagesSquare, Receipt } from 'lucide-vue-next'

export const ACTION = {
  invite: { label: 'Share invite', icon: UserPlus },
  room: { label: 'Open the room', icon: MessagesSquare },
  sign: { label: 'Review & sign', icon: PenLine },
  fund: { label: 'Fund with PayPal', icon: Wallet },
  submit: { label: 'Deliver work', icon: Send },
  resubmit: { label: 'See what failed', icon: Eye },
  review: { label: 'Open the report', icon: Eye },
  expenses: { label: 'See the receipt', icon: Receipt },
}
