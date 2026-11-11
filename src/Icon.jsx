import {
  Ambulance, Ban, Banknote, Bell, BellOff, Camera, CalendarDays, Check, CircleCheck, ClipboardList, Clock, Compass, CreditCard, Download, Droplet,
  Flag, Heart, Hospital, House, IdCard, Inbox, Lock, Mail, Map, MapPin, Menu, MessageCircle, Mic, MicOff, Moon, PartyPopper, PenLine, Phone,
  Pin, Plus, Search, Siren, Smartphone, Sparkles, Star, Stethoscope, Sun, TriangleAlert, Wrench, X,
} from 'lucide-react';

// One set of clean, consistent icons for the whole app, instead of emoji.
const ICONS = {
  alert: TriangleAlert,
  ambulance: Ambulance,
  ban: Ban,
  bell: Bell,
  'bell-off': BellOff,
  calendar: CalendarDays,
  camera: Camera,
  card: CreditCard,
  cash: Banknote,
  chat: MessageCircle,
  check: Check,
  'check-circle': CircleCheck,
  clock: Clock,
  compass: Compass,
  doctor: Stethoscope,
  download: Download,
  drop: Droplet,
  flag: Flag,
  heart: Heart,
  home: House,
  hospital: Hospital,
  id: IdCard,
  list: ClipboardList,
  lock: Lock,
  mail: Mail,
  map: Map,
  menu: Menu,
  mic: Mic,
  'mic-off': MicOff,
  mobile: Smartphone,
  moon: Moon,
  party: PartyPopper,
  pen: PenLine,
  phone: Phone,
  pin: MapPin,
  'pin-small': Pin,
  plus: Plus,
  search: Search,
  siren: Siren,
  sparkles: Sparkles,
  star: Star,
  sun: Sun,
  wrench: Wrench,
  inbox: Inbox,
  x: X,
};

/** A small icon that takes the colour and size of the text around it. */
export default function Icon({ name, size = '1.1em', filled = false, strokeWidth = 2, className = '' }) {
  const Glyph = ICONS[name];
  if (!Glyph) return null;
  return (
    <Glyph
      className={`icon ${className}`.trim()}
      size={size}
      strokeWidth={strokeWidth}
      fill={filled ? 'currentColor' : 'none'}
      aria-hidden="true"
      focusable="false"
    />
  );
}
