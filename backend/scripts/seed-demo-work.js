// Usage:
//   node scripts/seed-demo-work.js          add sample work requests (safe to run again)
//   node scripts/seed-demo-work.js --clear  remove them again
//
// Sample requests are posted by fake seeker accounts (demo.*@microservicehub.local), so they are easy to tell apart and to remove.
// Run it on your own computer for demos and tests. Do not point it at the live database unless you
// want visitors to see these jobs: real providers could try to apply for them.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { ensureSchema } = require('../migrate');

const DEMO_EMAIL = 'demo.seeker@microservicehub.local';

// [category, title, description, location, budget in BDT]
const WORK = [
  ['Delivery', 'Deliver a parcel from Mirpur to Uttara', 'One small box (about 2 kg) to be picked up from a shop in Mirpur 10 and handed over in Uttara Sector 7 before 6 pm.', 'Mirpur, Dhaka', 350],
  ['Delivery', 'Weekly grocery shopping and delivery', 'Buy a list of vegetables, fish and rice from the local bazaar every Friday morning and bring it home.', 'Dhanmondi, Dhaka', 500],
  ['Delivery', 'Collect documents from an office and bring them to me', 'Pick up a sealed envelope from an office in Motijheel and deliver it to my home. Needs ID shown at the gate.', 'Motijheel, Dhaka', 300],
  ['Home Care', 'Full flat cleaning before Eid', 'Three-bedroom flat, 1,200 sq ft. Floors, bathrooms, kitchen and windows. Cleaning supplies will be provided.', 'Bashundhara, Dhaka', 2200],
  ['Home Care', 'Maid for two hours every morning', 'Sweeping, mopping and washing dishes for a small family. Starting next week, six days a week.', 'Mohammadpur, Dhaka', 3500],
  ['Repairs', 'Fix a leaking kitchen tap', 'The tap drips all day and the sink pipe below also leaks a little. Need a plumber who brings the parts.', 'Uttara, Dhaka', 700],
  ['Repairs', 'Ceiling fan not working', 'Two ceiling fans stopped. Could be the capacitor or the regulator. Please check and repair.', 'Narayanganj', 600],
  ['Daily Tasks', 'Stand in a queue for a passport appointment', 'Need someone to wait in line at the passport office in Agargaon and hold my place from early morning.', 'Agargaon, Dhaka', 800],
  ['Daily Tasks', 'Buy medicine and bring it to my parents', 'Pick up a prescription from a pharmacy in Gulshan and deliver it to my parents in Banani the same day.', 'Gulshan, Dhaka', 300],
  ['Technology', 'Set up a new Wi-Fi router', 'New router and a new connection. Need help with setup, a strong password and moving the cables neatly.', 'Khilgaon, Dhaka', 500],
  ['Technology', 'Laptop is very slow, please fix', 'Five-year-old laptop takes ten minutes to start. Probably needs cleaning, new Windows or an SSD.', 'Rampura, Dhaka', 1200],
  ['Moving', 'Shift a one-bedroom flat', 'Furniture, a fridge, a washing machine and about 20 boxes. Need two helpers and a pickup truck.', 'Chattogram', 6500],
  ['Tutoring', 'Home tutor for Class 8 maths and science', 'Three evenings a week, one hour each. Looking for a patient tutor, preferably a university student.', 'Lalmatia, Dhaka', 4000],
  ['Tutoring', 'Spoken English practice for an adult', 'Two sessions a week to build confidence for job interviews. Conversation and basic grammar.', 'Sylhet', 2500],
  ['Beauty and Salon', 'Bridal makeup at home', 'Makeup and hair for a wedding on a Friday morning, including a trial a week before.', 'Uttara, Dhaka', 8000],
  ['Beauty and Salon', 'Haircut for an elderly man at home', 'My father cannot travel. A simple haircut and shave at home on a weekday.', 'Mirpur, Dhaka', 400],
  ['Cooking and Catering', 'Cook for a family dinner of 20 people', 'Chicken biryani, borhani and a dessert for a birthday dinner on Saturday evening. We buy the groceries.', 'Dhanmondi, Dhaka', 7000],
  ['Gardening', 'Set up a rooftop garden', 'Roof of 600 sq ft. Need pots, soil, drip watering and a few vegetable plants started.', 'Mohammadpur, Dhaka', 9000],
  ['Pet Care', 'Walk and feed my dog while I travel', 'A friendly Labrador. Two walks and two meals a day for one week in my home.', 'Gulshan, Dhaka', 3500],
  ['Photography', 'Photographer for a baby naming ceremony', 'About three hours at home. 100 edited photos by the next week.', 'Banani, Dhaka', 6000],
  ['Event Help', 'Decorate a hall for a birthday party', 'Balloons, banner and lights for a 40-person party. Setup two hours before the guests arrive.', 'Rajshahi', 4500],
  ['Driving', 'Driver for a day trip to Cox\'s Bazar', 'Experienced driver for a family car, two days one night. Fuel paid by us.', 'Chattogram', 7000],
  ['Child and Elder Care', 'Attendant for an elderly mother', 'Daytime help from 9 am to 5 pm: meals, medicine reminders and short walks. No heavy nursing.', 'Dhanmondi, Dhaka', 12000],
  ['Health Care', 'Nurse to give daily injections at home', 'A one-week course of injections, once every morning. Prescription available.', 'Uttara, Dhaka', 3000],
  ['Laundry and Ironing', 'Wash and iron 30 shirts', 'Pick up on Sunday, return washed and ironed by Wednesday.', 'Mirpur, Dhaka', 900],
  ['Deep Cleaning', 'Sofa and carpet deep cleaning', 'A five-seater sofa and two medium carpets. Vacuum, shampoo and dry.', 'Bashundhara, Dhaka', 3000],
  ['Painting', 'Paint two bedrooms', 'Two rooms, about 300 sq ft of wall each. Light colours, putty and two coats. Paint bought by us.', 'Khulna', 14000],
  ['Plumbing', 'Bathroom pipe replacement', 'The old pipe behind the basin cracked. Need it replaced, plus a new tap fitted.', 'Tongi', 1800],
  ['Electrical', 'Rewire a small shop', 'Eight lights, four sockets and a new switchboard in a 200 sq ft shop. Materials to be quoted.', 'Gazipur', 8000],
  ['AC and Appliance Service', 'Service two split ACs before summer', 'Cleaning, gas check and a test for two 1.5-ton split ACs.', 'Gulshan, Dhaka', 3000],
  ['AC and Appliance Service', 'Washing machine does not drain', 'Front-load machine stops with water inside. Needs a technician to check the pump.', 'Mirpur, Dhaka', 1500],
  ['Carpentry', 'Build a bookshelf and repair a door', 'A simple wooden bookshelf, 6 ft by 4 ft, and one bedroom door that does not close properly.', 'Rangpur', 7500],
  ['Pest Control', 'Cockroach treatment for a flat', 'Two-bedroom flat with a kitchen problem. Need gel treatment and spraying.', 'Mohammadpur, Dhaka', 2500],
  ['Car and Bike Care', 'Wash and service a motorbike', 'Full wash, oil change and chain cleaning for a 150 cc bike. Pick up from my home.', 'Uttara, Dhaka', 1200],
  ['Tailoring', 'Stitch a salwar kameez set', 'Three sets from cloth I will provide. Measurements taken at home.', 'Comilla', 3600],
  ['Design and Web', 'Logo and Facebook cover for a small shop', 'Name: Rahman Fashion House. Need a simple logo and a cover photo. Two rounds of changes.', 'Dhaka', 2500],
  ['Typing and Translation', 'Translate a 5-page document into English', 'Bangla to English, a business letter and a certificate. Needs to read naturally.', 'Dhaka', 1500],
  ['Mobile Repair', 'Replace a cracked phone screen', 'A mid-range Android phone. Need an original-quality screen and a one-month warranty.', 'Banani, Dhaka', 3500],
  ['Computer Repair', 'Install Windows and Office on a desktop', 'Clean install, drivers, antivirus and Microsoft Office. I will keep my files on an external drive.', 'Chattogram', 900],
  ['CCTV and Security Systems', 'Install 4 CCTV cameras at home', 'Four cameras, a recorder and phone viewing. Cables to be hidden neatly.', 'Bashundhara, Dhaka', 18000],
  ['Internet and Wi-Fi Setup', 'Extend Wi-Fi across three floors', 'Signal is weak on the upper floors. Needs access points or a mesh set-up.', 'Dhanmondi, Dhaka', 4500],
  ['Solar and Generator', 'Service a 2 kVA IPS and replace batteries', 'The IPS clicks and shuts down in load shedding. Two batteries are old.', 'Mirpur, Dhaka', 5000],
  ['Masonry and Construction', 'Repair a bathroom wall and plaster', 'Damp patches and a cracked wall in one bathroom. Needs plastering and waterproofing.', 'Narsingdi', 9000],
  ['Tiles and Flooring', 'Fit floor tiles in a kitchen', 'About 120 sq ft. Tiles already bought. Needs cutting, fitting and grouting.', 'Gazipur', 6500],
  ['Glass and Aluminium', 'Fit a sliding aluminium window', 'One window, 5 ft by 4 ft, with glass and a mosquito net.', 'Savar', 7000],
  ['Welding and Metalwork', 'Make a metal gate and grill', 'Front gate 8 ft wide and two window grills. A simple design, painted.', 'Bogura', 20000],
  ['Gas and Water Delivery', 'Regular drinking water jars every week', 'Four 20-litre jars delivered to the 4th floor every week. Lift is not available.', 'Malibagh, Dhaka', 800],
  ['Printing and Photocopy', 'Print and bind 50 copies of a report', 'A 30-page report in black and white with a colour cover, spiral bound.', 'Farmgate, Dhaka', 3500],
  ['Document Help', 'Help me fill in a trade licence form', 'First-time application for a small shop. Need help with the forms and the visit to the city corporation.', 'Dhaka', 2000],
  ['Fitness and Yoga', 'Yoga trainer for weekday mornings', 'One hour, three days a week at home. Beginner level, for a woman in her forties.', 'Uttara, Dhaka', 5000],
  ['Music and Dance Lessons', 'Guitar lessons for a 12-year-old', 'Two lessons a week at home. Beginner. We have a guitar.', 'Mirpur, Dhaka', 3500],
  ['Religious Teaching', 'Quran teacher for two children', 'Evening lessons, five days a week, for a 7-year-old and a 10-year-old. Tajweed basics.', 'Mohammadpur, Dhaka', 3000],
  ['Language Classes', 'Learn basic Japanese for a work visa', 'Twice a week, online or at home. N5 level target in four months.', 'Dhaka', 6000],
  ['Wedding Services', 'Stage decoration for a wedding reception', 'Hall of 300 guests. Stage, flower gate and entrance. Colour theme: red and gold.', 'Gulshan, Dhaka', 45000],
  ['Video Editing', 'Edit a 10-minute YouTube video', 'Cut, subtitles in Bangla, simple music and a thumbnail. Raw footage on Google Drive.', 'Dhaka', 2500],
  ['Social Media Help', 'Set up a Facebook page and run first ads', 'A small home bakery. Need a page, six starter posts and a BDT 2,000 ad campaign.', 'Dhaka', 3000],
  ['Data Entry', 'Type 200 customer records into a spreadsheet', 'Scanned forms to Excel. Accuracy matters. Needs to be finished in three days.', 'Dhaka', 2000],
  ['Waste and Recycling', 'Take away old furniture and electronics', 'An old sofa, a broken TV and a table. Needs a van and two helpers. Sell what you can.', 'Mirpur, Dhaka', 1500],
  ['Interior Design', 'Plan the interior of a small living room', 'A 14 by 12 ft room. Need a layout, a colour plan and a shopping list within a budget.', 'Dhaka', 5000],
  ['Security Guard', 'Night guard for a shop during Eid week', 'Seven nights, 10 pm to 6 am. A shop in a busy market.', 'Chattogram', 7000],
  ['Tour Guide', 'Guide for a day in Old Dhaka', 'Four relatives visiting. Walk through Shankhari Bazar, Lalbagh Fort and Ahsan Manzil with food stops.', 'Old Dhaka', 3500],
];

// Fake seekers, so the list looks like it comes from many different people.
const PEOPLE = [
  ['Rafiq Ahmed', 'rafiq', '01711000001'], ['Nusrat Jahan', 'nusrat', '01811000002'], ['Tanvir Hossain', 'tanvir', '01911000003'],
  ['Sumaiya Akter', 'sumaiya', '01611000004'], ['Imran Khan', 'imran', '01511000005'], ['Farhana Yeasmin', 'farhana', '01711000006'],
  ['Mizanur Rahman', 'mizanur', '01811000007'], ['Shirin Sultana', 'shirin', '01911000008'], ['Arif Chowdhury', 'arif', '01611000009'],
  ['Mahmuda Begum', 'mahmuda', '01511000010'], ['Sabbir Hasan', 'sabbir', '01711000011'], ['Tasnim Ara', 'tasnim', '01811000012'],
  ['Kamrul Islam', 'kamrul', '01911000013'], ['Nazma Khatun', 'nazma', '01611000014'], ['Jahid Alam', 'jahid', '01511000015'],
];

const PLACES = [
  'Dhanmondi, Dhaka', 'Mirpur, Dhaka', 'Uttara, Dhaka', 'Gulshan, Dhaka', 'Banani, Dhaka', 'Mohammadpur, Dhaka', 'Bashundhara, Dhaka',
  'Badda, Dhaka', 'Rampura, Dhaka', 'Motijheel, Dhaka', 'Old Dhaka', 'Tongi', 'Savar', 'Narayanganj', 'Gazipur', 'Chattogram',
  'Sylhet', 'Rajshahi', 'Khulna', 'Barishal', 'Rangpur', 'Comilla', 'Mymensingh', 'Cox\'s Bazar', 'Bogura', 'Jessore',
];

// [category, title, description, budget in BDT]. The place is picked at random.
const MORE_WORK = [
  ['Delivery', 'Deliver a birthday cake across the city', 'A boxed cake must be collected from a bakery and handed over carefully, still upright, before 4 pm.', 400],
  ['Delivery', 'Courier a laptop charger today', 'Small package, urgent. Pick up from my office and deliver to a friend. Proof of delivery with a photo please.', 350],
  ['Delivery', 'Daily tiffin pick-up from home to office', 'Pick up a lunch box at 11:30 am and bring it to my office, Monday to Friday for a month.', 4500],
  ['Delivery', 'Bring a medicine order from the main pharmacy', 'Some medicines are only available in one shop. Buy and bring them home, I will send the prescription photo.', 300],
  ['Home Care', 'Deep clean a kitchen and two bathrooms', 'Grease on the stove and walls, limescale in the bathrooms. Need strong cleaning supplies and about four hours.', 2400],
  ['Home Care', 'Cook and clean for a bachelor flat', 'Two meals a day and light cleaning, five days a week. Simple home food, no fancy dishes.', 7000],
  ['Home Care', 'Part-time house help for evenings', 'Washing dishes, folding clothes and tidying up from 5 pm to 8 pm, six days a week.', 4000],
  ['Repairs', 'Door lock is stuck, need a locksmith', 'The main door lock will not turn. Need it opened without damage and a new lock fitted if required.', 900],
  ['Repairs', 'Fix a leaking roof corner', 'Water comes in after rain at one corner of the top floor. Needs checking and waterproofing.', 3500],
  ['Repairs', 'Repair a broken window latch and curtain rod', 'Three small fixes around the flat. Bring your own tools and screws.', 700],
  ['Daily Tasks', 'Pay utility bills and queue at the bank', 'Pay electricity and gas bills in person and deposit a cheque. Receipts to be handed back to me.', 600],
  ['Daily Tasks', 'Assemble flat-pack furniture', 'A wardrobe and a study table from a furniture shop. Instructions are in the boxes.', 1200],
  ['Daily Tasks', 'Run errands on Friday afternoon', 'Three small stops in the same area: tailor, grocery and a print shop. About three hours.', 900],
  ['Technology', 'Set up a printer and a shared network', 'A new printer must work from two laptops and a phone over Wi-Fi.', 800],
  ['Technology', 'Recover photos from a broken phone', 'The phone does not turn on. Many family photos inside. Please try before I give up.', 2500],
  ['Technology', 'Build a simple website for a tailoring shop', 'Five pages: home, designs, prices, about and contact, with a Bangla and English version.', 12000],
  ['Technology', 'Teach my father to use a smartphone', 'Basics: calls, WhatsApp, photos and mobile banking. Patient teacher, two sessions.', 800],
  ['Moving', 'Move a single room to a new flat', 'A bed, a wardrobe, a desk and ten boxes. Same area, a small pickup is enough.', 3000],
  ['Moving', 'Carry heavy furniture up to the 5th floor', 'A sofa set and a fridge by stairs. Need two strong workers for about one hour.', 1500],
  ['Tutoring', 'English tutor for SSC candidate', 'Grammar and composition, three days a week. Exam in four months.', 4500],
  ['Tutoring', 'Chemistry and physics for HSC', 'Two hours twice a week. Student is weak in numericals. A university student is fine.', 6000],
  ['Tutoring', 'Primary teacher for a Class 3 student', 'All subjects, one hour every evening. Fun, patient approach, Bangla medium.', 3000],
  ['Tutoring', 'Coding basics for a teenager', 'Scratch, then Python. Online or at home, two lessons a week for two months.', 5000],
  ['Beauty and Salon', 'Party makeup and hair at home', 'Evening party, makeup and hair styling. Please bring your own products.', 3500],
  ['Beauty and Salon', 'Mehendi design for Eid eve', 'Both hands, Arabic design, for about four people. Evening time.', 2000],
  ['Beauty and Salon', 'Facial and manicure at home', 'A relaxing facial and manicure on a Saturday afternoon.', 1800],
  ['Cooking and Catering', 'Cook for a small iftar gathering', 'Eight people. Beguni, haleem, jilapi and a few simple items. We shop for the groceries.', 4000],
  ['Cooking and Catering', 'Catering for a small office lunch', 'Lunch for 25 staff: rice, chicken curry, vegetables, dal and salad. Delivered hot by 1 pm.', 7500],
  ['Cooking and Catering', 'Cake and snacks for a children\'s party', 'A two-kilo chocolate cake and snacks for 15 children, ready by Saturday noon.', 4500],
  ['Gardening', 'Trim trees and clean a small garden', 'Front garden with a mango tree and hedges, overgrown. Take away the cuttings.', 2200],
  ['Gardening', 'Balcony plants setup and care plan', 'A sunny balcony, 12 pots. Choose hardy plants and teach me how to look after them.', 3500],
  ['Pet Care', 'Groom a cat and give a bath', 'A calm cat, long hair. Bath, brushing and nail trimming at home.', 1200],
  ['Pet Care', 'Take my dog to the vet', 'Pick up in the morning, wait at the clinic for the visit and bring the dog home with a report.', 1500],
  ['Photography', 'Product photos for an online shop', '30 items on a white background, clean and bright. Edited files by the next day.', 5000],
  ['Photography', 'Graduation photo session', 'Two hours at a university campus with friends, 40 edited photos.', 4500],
  ['Photography', 'Event photographer for an engagement party', 'Four hours in the evening, a candid style, a photo album of 60 pictures.', 9000],
  ['Event Help', 'Waiters and helpers for a family dinner', 'Four helpers to serve and clean up for a 60-person dinner. From 6 pm to 11 pm.', 6000],
  ['Event Help', 'Sound system and lights for a house party', 'Speakers and simple lights for an evening in a hall. Setup and removal included.', 8000],
  ['Event Help', 'Emcee for a company annual dinner', 'Confident host in Bangla and English for a 150-person event. Script provided.', 10000],
  ['Driving', 'Airport pick-up and drop at night', 'Pick-up from Hazrat Shahjalal Airport to Gulshan at midnight. Flight details shared.', 1200],
  ['Driving', 'Driver for a week in my own car', 'Daily office run in the morning and evening for one week while my regular driver is away.', 5500],
  ['Driving', 'Teach me to drive a car', 'Ten lessons in a quiet area for a complete beginner, using my car.', 6000],
  ['Child and Elder Care', 'Babysitter for weekend evenings', 'Looking after a 4-year-old and a 7-year-old on Saturday evenings. Dinner will be provided.', 2000],
  ['Child and Elder Care', 'Night attendant for a post-surgery patient', 'Stay overnight at home, help with water, medicine and moving. One week.', 8500],
  ['Health Care', 'Physiotherapy at home after a knee injury', 'Three sessions a week for a month. Doctor\'s advice is available.', 7000],
  ['Health Care', 'Blood sugar and pressure check at home', 'A weekly visit for an elderly couple, with a short note after each check.', 2000],
  ['Laundry and Ironing', 'Iron 50 clothes every week', 'Pick up on Saturday morning and return on Sunday evening. Regular work.', 1500],
  ['Laundry and Ironing', 'Dry-clean two suits and a coat', 'Collect from my home and bring them back in covers, within three days.', 1800],
  ['Deep Cleaning', 'Post-construction cleaning of a new flat', 'Dust, paint marks and cement on floors and windows after renovation. 1,100 sq ft.', 7000],
  ['Deep Cleaning', 'Water tank and rooftop tank cleaning', 'Both tanks need a proper clean and disinfection. Report with before and after photos.', 3000],
  ['Painting', 'Touch up the walls of a small office', 'Fix marks and repaint one meeting room and the entrance. Weekend work only.', 11000],
  ['Painting', 'Paint an iron gate and a grill', 'Remove the rust and apply two coats of anti-rust paint and finishing colour.', 2500],
  ['Plumbing', 'Install a water pump and fix pipes', 'New pump to be fitted to the ground tank. Joints and pipes to be checked for leaks.', 4000],
  ['Plumbing', 'Clear a blocked bathroom drain', 'Water rises slowly and smells. Needs unblocking and a final test.', 900],
  ['Electrical', 'Install four ceiling fans and some lights', 'New fans bought. Wiring check and installation, with new regulators.', 2200],
  ['Electrical', 'Fix short circuit and replace the main switch', 'The main switch gets hot and trips. A licensed electrician is preferred.', 2500],
  ['Electrical', 'Set up an earthing system for a small building', 'Proper earthing for a two-storey home with a test report.', 6500],
  ['AC and Appliance Service', 'Install a new split AC', 'New 1-ton split AC, pipe length about 12 feet. Include a stand and drainage.', 4500],
  ['AC and Appliance Service', 'Fridge not cooling', 'Double-door refrigerator, 8 years old. The freezer works but the lower part is warm.', 2000],
  ['Carpentry', 'Make a wooden kitchen cabinet', 'Wall and base cabinets, 8 ft total. A simple design, a tough finish for moisture.', 28000],
  ['Carpentry', 'Repair three wooden chairs', 'Loose legs and a broken seat. Glue and screws, plus a light polish.', 1500],
  ['Pest Control', 'Termite treatment for a wooden wardrobe', 'Termites have started in the bottom of a wardrobe. Treat and prevent a return.', 2800],
  ['Pest Control', 'Mosquito fogging for a housing society', 'A small society with a garden and a drain. A day visit and a monthly plan if it works.', 6000],
  ['Car and Bike Care', 'Wash and polish a sedan at home', 'Full interior and exterior wash, wax polish and tyre shine on a Saturday.', 1500],
  ['Car and Bike Care', 'Change tyres and align a car', 'Four new tyres supplied by me. Fit, balance and align. Mobile service preferred.', 2000],
  ['Tailoring', 'Alter five office shirts and trousers', 'Take in the waist and shorten sleeves. Pick-up and return at my home.', 1800],
  ['Tailoring', 'Sew curtains for three windows', 'Cloth bought. Measure the windows, stitch and hang the curtains.', 3200],
  ['Design and Web', 'Poster and banner for a school event', 'One poster and one large banner in Bangla and English, print-ready files.', 3000],
  ['Design and Web', 'Business cards and a letterhead', 'For a small clinic. Print-ready, with two design options to choose from.', 2500],
  ['Typing and Translation', 'Type a handwritten thesis chapter', 'About 40 pages of neat handwriting into a Word document with correct formatting.', 3500],
  ['Typing and Translation', 'Translate a short film script into Bangla', 'Twelve pages. Natural dialogues, not word-for-word translation.', 4000],
  ['Mobile Repair', 'Phone battery not charging', 'The phone charges only with a certain cable. Maybe the port. Check and fix.', 800],
  ['Mobile Repair', 'Water-damaged phone, please check', 'Fell in water yesterday, the screen shows lines. Need a diagnosis and a quote.', 1500],
  ['Computer Repair', 'Laptop keyboard replacement', 'Several keys stopped working on a 4-year-old laptop. Prefer a visit to my home.', 2200],
  ['Computer Repair', 'Upgrade a desktop with an SSD and more RAM', 'The parts are bought. Install, clone the old disk and confirm everything works.', 1000],
  ['CCTV and Security Systems', 'Fix an old CCTV recorder', 'Two cameras show no picture and the recorder beeps. Needs checking and repair.', 2000],
  ['Internet and Wi-Fi Setup', 'Fibre connection and router setup for a shop', 'Run the cable neatly, set up a router and a guest network.', 1800],
  ['Solar and Generator', 'Install a rooftop solar panel for a small shop', 'A 1 kW system for lights and fans. Quote with the equipment list please.', 85000],
  ['Masonry and Construction', 'Build a boundary wall of 40 feet', 'Brick wall, 5 ft high with a small gate opening. Materials to be quoted.', 45000],
  ['Tiles and Flooring', 'Replace broken bathroom tiles', 'About ten cracked tiles and a few loose ones. Matching tiles are available.', 3500],
  ['Glass and Aluminium', 'Replace a broken glass door panel', 'A 6 mm tempered glass panel in the balcony door. Needs measuring and fitting.', 5500],
  ['Welding and Metalwork', 'Fix a gate hinge and weld a grill', 'The heavy gate has dropped. Repair the hinge and weld a cracked grill.', 2500],
  ['Gas and Water Delivery', 'Gas cylinder delivery every month', 'One 12 kg cylinder to the 3rd floor each month. Please call before coming.', 1400],
  ['Printing and Photocopy', 'Print 200 wedding cards', 'A simple, elegant design, matching envelopes. Samples before the final order.', 8000],
  ['Document Help', 'Help with a university admission form', 'Fill in an online form, scan and upload documents, and print the admit card.', 800],
  ['Document Help', 'Renew a driving licence', 'Complete the process from forms to fingerprints. I can give all the documents.', 2500],
  ['Fitness and Yoga', 'Personal trainer for weight loss', 'Four mornings a week at a nearby park or home. Diet advice welcome.', 7000],
  ['Music and Dance Lessons', 'Tabla and harmonium lessons', 'Beginner for an adult. Two classes a week at home.', 4500],
  ['Music and Dance Lessons', 'Dance trainer for a school programme', 'Choreography for a 10-minute group dance, 20 girls, four rehearsals.', 8000],
  ['Religious Teaching', 'Arabic reading classes for a grown-up', 'Learn to read with the right pronunciation. Three evenings a week.', 3000],
  ['Language Classes', 'IELTS speaking and writing coaching', 'Target band 7. Two sessions a week for three months. Mock tests included.', 9000],
  ['Language Classes', 'Learn basic Arabic for a job abroad', 'Spoken Arabic for work. Evenings, online is fine.', 5000],
  ['Wedding Services', 'Wedding photography and video, one day', 'Holud, wedding and reception. Photos and a highlight video. Quote with your packages.', 60000],
  ['Wedding Services', 'Mehendi and bridal dressing for a holud', 'Bride and four family members. Saturday afternoon.', 9000],
  ['Video Editing', 'Edit a wedding highlight video', 'Eight minutes of the best moments with music and a title. Footage is ready.', 4000],
  ['Video Editing', 'Make short reels for a restaurant', 'Five short vertical videos of food and the dining room, with trending music.', 5000],
  ['Social Media Help', 'Manage a small boutique page for a month', 'Three posts a week, reply to messages and a simple monthly report.', 6000],
  ['Data Entry', 'Enter product details into an online store', '120 products, each with a title, description and price. Images are ready.', 3000],
  ['Data Entry', 'Digitise handwritten student marks', 'Marks sheets for 300 students into a clean spreadsheet. Needs a check for errors.', 2500],
  ['Waste and Recycling', 'Clear out a store room', 'About 20 boxes of old items. Sort, take away and throw or recycle suitable things.', 2000],
  ['Interior Design', 'Redesign a small office reception', 'Seating, lighting and a logo wall within a modest budget. A 3D picture helps.', 15000],
  ['Interior Design', 'Choose curtains and sofa colours', 'A tired living room. Need a colour scheme and a shopping plan with prices.', 3000],
  ['Security Guard', 'Guard for a three-day wedding event', 'Entrance and parking duty for a wedding hall in the evenings.', 6000],
  ['Tour Guide', 'Guide for a Sundarbans trip', 'A friendly local guide for a family of five on a two-day trip. Boat arrangements to be discussed.', 12000],
  ['Tour Guide', 'City guide for visitors in Sylhet', 'Tea gardens, Ratargul and Jaflong in one day. Pick-up from the hotel.', 8000],
];

const pick = (list) => list[Math.floor(Math.random() * list.length)];

async function ensurePerson(name, handle, phone) {
  const email = `demo.${handle}@microservicehub.local`;
  const [rows] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
  if (rows.length) return rows[0].id;
  // The password is random and never shown: nobody logs in as these accounts.
  const hash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12);
  const [result] = await db.query(
    `INSERT INTO users (full_name, email, password_hash, role, phone, kyc_status, nid_status, email_verified)
     VALUES (?, ?, ?, 'seeker', ?, 'verified', 'verified', 1)`,
    [name, email, hash, phone]
  );
  return result.insertId;
}

async function main() {
  await ensureSchema();

  if (process.argv.includes('--clear')) {
    const [users] = await db.query("SELECT id FROM users WHERE email LIKE 'demo.%@microservicehub.local'");
    if (users.length) {
      const ids = users.map((row) => row.id);
      const [removed] = await db.query("DELETE FROM services WHERE seeker_id IN (?) AND status = 'open'", [ids]);
      console.log(`Removed ${removed.affectedRows} sample work request(s).`);
      // Take away the fake people too, when nothing else points at them.
      for (const id of ids) {
        try {
          await db.query('DELETE FROM users WHERE id = ?', [id]);
        } catch {
          /* still referenced by something: keep the account */
        }
      }
    } else {
      console.log('No sample requests found.');
    }
    return;
  }

  const people = [];
  for (const [name, handle, phone] of PEOPLE) people.push(await ensurePerson(name, handle, phone));

  // One demo seeker owns every sample request. The password is random and never shown: nobody logs in as it.
  let [users] = await db.query('SELECT id FROM users WHERE email = ?', [DEMO_EMAIL]);
  if (!users.length) {
    const hash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12);
    await db.query(
      `INSERT INTO users (full_name, email, password_hash, role, phone, kyc_status, nid_status, email_verified)
       VALUES ('MicroServiceHub Demo', ?, ?, 'seeker', '01700000000', 'verified', 'verified', 1)`,
      [DEMO_EMAIL, hash]
    );
    [users] = await db.query('SELECT id FROM users WHERE email = ?', [DEMO_EMAIL]);
  }
  const seekerId = users[0].id;

  const [categories] = await db.query('SELECT id, name FROM categories');
  const byName = new Map(categories.map((row) => [row.name, row.id]));

  // The first list keeps its fixed places; the second gets a random place. Both go to random fake people.
  const all = [
    ...WORK.map(([category, title, description, location, budget]) => ({ category, title, description, location, budget })),
    ...MORE_WORK.map(([category, title, description, budget]) => ({ category, title, description, location: pick(PLACES), budget })),
  ];

  let added = 0;
  for (const { category, title, description, location, budget } of all) {
    const categoryId = byName.get(category);
    if (!categoryId) continue;

    // Skip a title that already exists from any demo account, so running it again adds nothing twice.
    const [existing] = await db.query(
      "SELECT s.id FROM services s JOIN users u ON u.id = s.seeker_id WHERE s.title = ? AND u.email LIKE 'demo.%@microservicehub.local'",
      [title]
    );
    if (existing.length) continue;

    const owner = Math.random() < 0.15 ? seekerId : pick(people);
    // Spread the dates over the last three weeks so the list does not look like one batch.
    const daysAgo = Math.floor(Math.random() * 21);
    await db.query(
      `INSERT INTO services (seeker_id, category_id, title, description, location, budget, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'open', DATE_SUB(NOW(), INTERVAL ? DAY))`,
      [owner, categoryId, title, description, location, budget, daysAgo]
    );
    added += 1;
  }

  console.log(`Added ${added} sample work request(s). Run with --clear to remove them.`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
