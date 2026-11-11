import {
  Ambulance, AppWindow, Baby, BookOpen, BrickWall, Bug, Camera, Car, CarFront, Cctv, ChefHat, Clapperboard, Compass, Dumbbell, Droplets, FileText,
  Flame, Fuel, Gem, Hammer, HeartPulse, House, Languages, Laptop, LayoutGrid, Library, Megaphone, MessagesSquare, Monitor, Music, Package, PaintRoller,
  PartyPopper, PawPrint, PenTool, Printer, Recycle, Ruler, Scissors, ShieldCheck, Shirt, ShoppingBag, Smartphone, Snowflake, Sofa, Sparkles, SprayCan,
  Sprout, Stethoscope, Sun, Table, Truck, Wifi, Wrench, Zap,
} from 'lucide-react';

// One clean icon for every service type, shared by the home page, Explore and the landing page.
export const CATEGORY_ICONS = {
  Delivery: Package,
  'Home Care': House,
  Repairs: Wrench,
  'Daily Tasks': ShoppingBag,
  Technology: Laptop,
  Moving: Truck,
  Tutoring: BookOpen,
  'Beauty and Salon': Scissors,
  'Cooking and Catering': ChefHat,
  Gardening: Sprout,
  'Pet Care': PawPrint,
  Photography: Camera,
  'Event Help': PartyPopper,
  Driving: Car,
  'Child and Elder Care': Baby,
  'Health Care': HeartPulse,
  'Laundry and Ironing': Shirt,
  'Deep Cleaning': SprayCan,
  Painting: PaintRoller,
  Plumbing: Droplets,
  Electrical: Zap,
  'AC and Appliance Service': Snowflake,
  Carpentry: Hammer,
  'Pest Control': Bug,
  'Car and Bike Care': CarFront,
  Tailoring: Ruler,
  'Design and Web': PenTool,
  'Typing and Translation': Languages,
  'Security Guard': ShieldCheck,
  'Tour Guide': Compass,
  'Mobile Repair': Smartphone,
  'Computer Repair': Monitor,
  'CCTV and Security Systems': Cctv,
  'Internet and Wi-Fi Setup': Wifi,
  'Solar and Generator': Sun,
  'Masonry and Construction': BrickWall,
  'Tiles and Flooring': LayoutGrid,
  'Glass and Aluminium': AppWindow,
  'Welding and Metalwork': Flame,
  'Gas and Water Delivery': Fuel,
  'Printing and Photocopy': Printer,
  'Document Help': FileText,
  'Fitness and Yoga': Dumbbell,
  'Music and Dance Lessons': Music,
  'Religious Teaching': Library,
  'Language Classes': MessagesSquare,
  'Wedding Services': Gem,
  'Video Editing': Clapperboard,
  'Social Media Help': Megaphone,
  'Data Entry': Table,
  'Waste and Recycling': Recycle,
  'Interior Design': Sofa,
  Ambulance,
  'Online Doctor': Stethoscope,
};

/** The icon for a service type. */
export function CategoryIcon({ name, size = '1em', strokeWidth = 2, className = '' }) {
  const Glyph = CATEGORY_ICONS[name] || Sparkles;
  return <Glyph className={`icon ${className}`.trim()} size={size} strokeWidth={strokeWidth} aria-hidden="true" focusable="false" />;
}

// Soft tile colours: a pale background, a stronger tint for the icon chip, a glow, and the icon colour.
const TONES = [
  { bg: '#fff1f0', chip: '#fde0dd', glow: 'rgba(238, 112, 100, 0.22)', fg: '#d9453c' },
  { bg: '#eef4ff', chip: '#dbe7ff', glow: 'rgba(89, 130, 240, 0.22)', fg: '#3f6fe0' },
  { bg: '#eafaf5', chip: '#d2f2e7', glow: 'rgba(40, 170, 130, 0.22)', fg: '#1f9d78' },
  { bg: '#f4efff', chip: '#e6dcff', glow: 'rgba(140, 100, 235, 0.22)', fg: '#7a55e0' },
  { bg: '#fff4ea', chip: '#ffe3cc', glow: 'rgba(240, 150, 70, 0.22)', fg: '#e07a2b' },
  { bg: '#f1f6ec', chip: '#e0ecd3', glow: 'rgba(110, 160, 70, 0.22)', fg: '#4f9a3a' },
  { bg: '#fffaea', chip: '#fff0c4', glow: 'rgba(225, 180, 40, 0.22)', fg: '#c99a14' },
  { bg: '#eef7fa', chip: '#d8edf3', glow: 'rgba(60, 150, 180, 0.22)', fg: '#2a8aa6' },
];

export const toneFor = (index) => TONES[index % TONES.length];
