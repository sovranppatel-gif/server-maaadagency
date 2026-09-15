/**
 * Seed dataset. Mirrors the fixtures the dashboard was built against, so the
 * UI looks identical the moment it is pointed at the real API.
 * Dates are expressed as day offsets from "today" to keep the data fresh.
 */

export const services = [
  { name: "Print Media", description: "Newspaper, magazine and classified ads.", icon: "Newspaper" },
  { name: "Electronic Media", description: "TV commercials across local and national channels.", icon: "Tv" },
  { name: "Radio Ads", description: "Radio spots on leading FM stations.", icon: "Radio" },
  { name: "Flex & Offset Printing", description: "High-quality flex, vinyl, standee and offset printing.", icon: "Printer" },
  { name: "Outdoor Advertising", description: "Hoardings, bus branding, cycle and e-rickshaw branding.", icon: "Landmark" },
  { name: "Promotional Vans", description: "Branded van and hydraulic LED van promotions.", icon: "Truck" },
  { name: "Digital Wall Painting", description: "High-impact printed wall branding.", icon: "PaintRoller" },
  { name: "LED Screens", description: "Indoor and outdoor LED display solutions.", icon: "MonitorPlay" },
  { name: "Digital Marketing", description: "Social media, SEO and Google Ads campaigns.", icon: "Megaphone" },
  { name: "Event Management", description: "End-to-end planning for corporate and private events.", icon: "PartyPopper" },
  { name: "Corporate Gifting", description: "Customized corporate gifts and merchandise.", icon: "Gift" },
  { name: "Brand Strategy", description: "Creative strategy and positioning.", icon: "Lightbulb", status: "Disabled" },
  // Digital product services the WhatsApp bot offers as options.
  { name: "Website", description: "Marketing websites and landing pages.", icon: "Sparkles" },
  { name: "Web Application", description: "Custom web portals and dashboards.", icon: "Sparkles" },
  { name: "Mobile Application", description: "Android and iOS applications.", icon: "Sparkles" },
  { name: "UI/UX Design", description: "Product and interface design.", icon: "Sparkles" },
  { name: "Custom Software", description: "Bespoke internal tools and automation.", icon: "Sparkles" },
];

export const employees = [
  { key: "emp-1", code: "EMP-001", name: "Rahul Sharma", role: "UI/UX Designer", email: "rahul.sharma@maaadagency.com", phone: "98765 43210", avatarColor: "#C5161D", availability: "Available", skills: ["Figma", "UI Design", "Prototyping"], joinedAt: "2022-03-14" },
  { key: "emp-2", code: "EMP-002", name: "Amit Kumar", role: "Full-Stack Developer", email: "amit.kumar@maaadagency.com", phone: "98765 43211", avatarColor: "#2563eb", availability: "Busy", skills: ["React", "Next.js", "Node.js"], joinedAt: "2021-07-02" },
  { key: "emp-3", code: "EMP-003", name: "Priya Verma", role: "Graphic Designer", email: "priya.verma@maaadagency.com", phone: "98765 43212", avatarColor: "#7c3aed", availability: "Available", skills: ["Illustrator", "Photoshop", "Branding"], joinedAt: "2020-11-19" },
  { key: "emp-4", code: "EMP-004", name: "Sandeep Yadav", role: "Digital Marketer", email: "sandeep.yadav@maaadagency.com", phone: "98765 43213", avatarColor: "#059669", availability: "Available", skills: ["SEO", "Google Ads", "Meta Ads"], joinedAt: "2023-01-09" },
  { key: "emp-5", code: "EMP-005", name: "Neha Singh", role: "Frontend Developer", email: "neha.singh@maaadagency.com", phone: "98765 43214", avatarColor: "#db2777", availability: "Busy", skills: ["React", "Tailwind", "Animation"], joinedAt: "2023-05-22" },
  { key: "emp-6", code: "EMP-006", name: "Vikas Patel", role: "Video Editor", email: "vikas.patel@maaadagency.com", phone: "98765 43215", avatarColor: "#d97706", availability: "On Leave", skills: ["Premiere Pro", "After Effects"], joinedAt: "2021-02-11" },
  { key: "emp-7", code: "EMP-007", name: "Ankita Rao", role: "Content Writer", email: "ankita.rao@maaadagency.com", phone: "98765 43216", avatarColor: "#0891b2", availability: "Available", skills: ["Copywriting", "SEO Content"], joinedAt: "2022-08-30" },
  { key: "emp-8", code: "EMP-008", name: "Manoj Tiwari", role: "Backend Developer", email: "manoj.tiwari@maaadagency.com", phone: "98765 43217", avatarColor: "#4338ca", availability: "Busy", skills: ["Node.js", "MongoDB", "APIs"], joinedAt: "2022-01-17" },
];

export const clients = [
  { key: "cl-1", code: "CL-001", name: "Ravi Mehta", company: "ABC Agency", phone: "919876543210", email: "ravi@abcagency.in", avatarColor: "#C5161D" },
  { key: "cl-2", code: "CL-002", name: "Sunita Rao", company: "XYZ Pvt Ltd", phone: "919812345678", email: "sunita@xyzpvt.com", avatarColor: "#2563eb" },
  { key: "cl-3", code: "CL-003", name: "Karan Malhotra", company: "Malhotra Motors", phone: "919765432109", email: "karan@malhotramotors.in", avatarColor: "#059669" },
  { key: "cl-4", code: "CL-004", name: "Deepa Nair", company: "Nair Interiors", phone: "919654321098", email: "deepa@nairinteriors.com", avatarColor: "#7c3aed" },
  { key: "cl-5", code: "CL-005", name: "Suresh Iyer", company: "Iyer Finance Consultants", phone: "919543210987", email: "suresh@iyerfinance.com", avatarColor: "#d97706" },
  { key: "cl-6", code: "CL-006", name: "Pooja Bansal", company: "Bansal Jewellers", phone: "919432109876", email: "pooja@bansaljewellers.com", avatarColor: "#db2777" },
  { key: "cl-7", code: "CL-007", name: "Anil Kapoor", company: "Kapoor Builders", phone: "919321098765", email: "anil@kapoorbuilders.in", avatarColor: "#0891b2" },
  { key: "cl-8", code: "CL-008", name: "Meera Joshi", company: "Joshi Hospitals", phone: "919210987654", email: "meera@joshihospitals.com", avatarColor: "#4338ca" },
];

export const leads = [
  { code: "LD-1042", client: "cl-1", service: "UI/UX Design", requirement: "E-commerce Homepage", description: "Need a modern, conversion-focused homepage redesign for our fashion e-commerce store, with mobile-first layout.", referenceWebsite: "https://www.myntra.com", deadlineIn: 11, budget: "Rs 35,000 - Rs 50,000", source: "WhatsApp", priority: "HIGH", status: "New", createdAgo: 0 },
  { code: "LD-1041", client: "cl-2", service: "Website", requirement: "Corporate Website", description: "5-page corporate website with about, services, careers and contact pages.", deadlineIn: 18, budget: "Rs 40,000", source: "Website", priority: "MEDIUM", status: "New", createdAgo: 0 },
  { code: "LD-1040", client: "cl-3", service: "Digital Marketing", requirement: "Festive Season Ad Campaign", description: "Run Meta and Google ads for Diwali offers across 3 showroom locations.", deadlineIn: 6, budget: "Rs 1,20,000", source: "Referral", priority: "URGENT", status: "Assigned", employee: "emp-4", createdAgo: 2 },
  { code: "LD-1039", client: "cl-4", service: "Brand Strategy", requirement: "Logo + Brand Identity", description: "New logo, business card, letterhead and Instagram brand kit for an interior design studio.", deadlineIn: 14, budget: "Rs 25,000", source: "WhatsApp", priority: "MEDIUM", status: "In Progress", employee: "emp-3", createdAgo: 4 },
  { code: "LD-1038", client: "cl-6", service: "Web Application", requirement: "Jewellery Catalogue Portal", description: "Admin-managed catalogue portal with price-on-request enquiry form.", referenceWebsite: "https://www.tanishq.co.in", deadlineIn: 26, budget: "Rs 90,000", source: "Manual", priority: "HIGH", status: "Assigned", employee: "emp-2", createdAgo: 1 },
  { code: "LD-1037", client: "cl-8", service: "Mobile Application", requirement: "Patient Appointment App", description: "Android and iOS app for booking OPD appointments, with doctor availability calendar.", deadlineIn: 52, budget: "Rs 2,50,000", source: "WhatsApp", priority: "HIGH", status: "Submitted", employee: "emp-8", createdAgo: 17 },
  { code: "LD-1036", client: "cl-5", service: "Website", requirement: "Landing Page for Lead Gen", description: "Single landing page for mutual fund SIP lead generation with a calculator widget.", deadlineIn: 4, budget: "Rs 18,000", source: "Referral", priority: "LOW", status: "Completed", employee: "emp-5", createdAgo: 27 },
  { code: "LD-1035", client: "cl-7", service: "Outdoor Advertising", requirement: "Hoarding Design for New Launch", description: "3 hoarding creatives for upcoming residential project launch across Raipur.", deadlineIn: 5, budget: "Rs 22,000", source: "Manual", priority: "MEDIUM", status: "Changes Requested", employee: "emp-3", createdAgo: 7 },
  { code: "LD-1034", client: "cl-1", service: "Digital Marketing", requirement: "Instagram Growth Campaign", description: "Monthly retainer for Instagram content and paid promotion.", deadlineIn: 16, budget: "Rs 15,000/mo", source: "WhatsApp", priority: "LOW", status: "Approved", employee: "emp-4", createdAgo: 10 },
  { code: "LD-1033", client: "cl-2", service: "Custom Software", requirement: "Internal HR Tool", description: "Leave management and attendance tracking tool for 40 employees.", deadlineIn: 31, budget: "Rs 1,80,000", source: "Website", priority: "MEDIUM", status: "In Progress", employee: "emp-8", createdAgo: 6 },
  { code: "LD-1032", client: "cl-3", service: "LED Screens", requirement: "Showroom LED Wall Content", description: "Motion graphics content for a 12x6 ft indoor LED wall.", deadlineIn: 8, budget: "Rs 28,000", source: "Referral", priority: "MEDIUM", status: "New", createdAgo: 1 },
  { code: "LD-1031", client: "cl-4", service: "Event Management", requirement: "Studio Launch Event", description: "Plan and execute a 100-guest studio launch event with media coverage.", deadlineIn: 17, budget: "Rs 75,000", source: "WhatsApp", priority: "HIGH", status: "New", createdAgo: 0 },
  { code: "LD-1030", client: "cl-8", service: "Print Media", requirement: "Health Camp Pamphlets", description: "5000 pamphlets for a free health checkup camp.", deadlineIn: 3, budget: "Rs 6,000", source: "Manual", priority: "LOW", status: "Completed", employee: "emp-7", createdAgo: 10 },
  { code: "LD-1029", client: "cl-6", service: "UI/UX Design", requirement: "New Collection Landing Page", description: "Landing page for the new Navratri collection with a lookbook gallery.", deadlineIn: 7, budget: "Rs 20,000", source: "WhatsApp", priority: "URGENT", status: "Assigned", employee: "emp-1", createdAgo: 1 },
];

export const works = [
  { code: "WK-2201", lead: "LD-1037", client: "cl-8", employee: "emp-8", title: "Patient Appointment App", description: "Android and iOS app for booking OPD appointments, with doctor availability calendar.", service: "Mobile Application", priority: "HIGH", deadlineIn: 52, status: "SUBMITTED", progress: 100, createdAgo: 14,
    report: { summary: "Completed appointment booking flow, doctor calendar, and push notifications. Ready for QA.", remarks: "Backend API integrated with test data. Awaiting go-ahead for production hosting.", timeSpent: "68 hrs", files: [{ name: "app-release-build.apk", size: "24 MB", type: "other" }], screenshots: [{ name: "home-screen.png", size: "340 KB", type: "image" }, { name: "booking-flow.png", size: "310 KB", type: "image" }] } },
  { code: "WK-2200", lead: "LD-1035", client: "cl-7", employee: "emp-3", title: "Hoarding Design for New Launch", description: "3 hoarding creatives for upcoming residential project launch across Raipur.", service: "Outdoor Advertising", priority: "MEDIUM", deadlineIn: 5, status: "CHANGES_REQUESTED", progress: 80, createdAgo: 7,
    report: { summary: "First draft of all 3 hoarding creatives completed.", remarks: "Used brand blue instead of the preferred maroon - pending confirmation.", timeSpent: "9 hrs", screenshots: [{ name: "hoarding-draft-1.png", size: "1.1 MB", type: "image" }] },
    revisions: [{ notes: "Please change the colour scheme to maroon and gold as per brand guideline, and enlarge the RERA number.", priority: "MEDIUM", deadlineIn: 5 }] },
  { code: "WK-2199", lead: "LD-1039", client: "cl-4", employee: "emp-3", title: "Logo + Brand Identity", description: "New logo, business card, letterhead and Instagram brand kit for an interior design studio.", service: "Brand Strategy", priority: "MEDIUM", deadlineIn: 14, status: "IN_PROGRESS", progress: 55, createdAgo: 4 },
  { code: "WK-2198", lead: "LD-1038", client: "cl-6", employee: "emp-2", title: "Jewellery Catalogue Portal", description: "Admin-managed catalogue portal with price-on-request enquiry form.", service: "Web Application", priority: "HIGH", deadlineIn: 26, status: "ASSIGNED", progress: 5, createdAgo: 1 },
  { code: "WK-2197", lead: "LD-1033", client: "cl-2", employee: "emp-8", title: "Internal HR Tool", description: "Leave management and attendance tracking tool for 40 employees.", service: "Custom Software", priority: "MEDIUM", deadlineIn: 31, status: "IN_PROGRESS", progress: 30, createdAgo: 6 },
  { code: "WK-2196", client: "cl-1", title: "E-commerce Homepage UI", description: "Modern, conversion-focused homepage redesign for fashion e-commerce store.", service: "UI/UX Design", priority: "HIGH", deadlineIn: 11, status: "UNASSIGNED", progress: 0, createdAgo: 0 },
  { code: "WK-2195", lead: "LD-1034", client: "cl-1", employee: "emp-4", title: "Instagram Growth Campaign", description: "Monthly retainer for Instagram content and paid promotion.", service: "Digital Marketing", priority: "LOW", deadlineIn: 16, status: "APPROVED", progress: 100, createdAgo: 10,
    report: { summary: "Content calendar for the month delivered, ads live since the 8th.", remarks: "CTR trending 2.1 percent, above account average.", timeSpent: "22 hrs" } },
  { code: "WK-2194", lead: "LD-1036", client: "cl-5", employee: "emp-5", title: "Landing Page for Lead Gen", description: "Single landing page for mutual fund SIP lead generation with a calculator widget.", service: "Website", priority: "LOW", deadlineIn: 4, status: "COMPLETED", progress: 100, createdAgo: 27,
    report: { summary: "Landing page deployed with SIP calculator, form connected to CRM webhook.", remarks: "Client approved on first review.", timeSpent: "14 hrs" } },
  { code: "WK-2193", client: "cl-3", title: "Showroom LED Wall Content", description: "Motion graphics content for a 12x6 ft indoor LED wall.", service: "LED Screens", priority: "MEDIUM", deadlineIn: 8, status: "UNASSIGNED", progress: 0, createdAgo: 1 },
  { code: "WK-2192", lead: "LD-1030", client: "cl-8", employee: "emp-7", title: "Health Camp Pamphlets", description: "5000 pamphlets for a free health checkup camp.", service: "Print Media", priority: "LOW", deadlineIn: 3, status: "COMPLETED", progress: 100, createdAgo: 10,
    report: { summary: "Design finalised, sent to print vendor, 5000 copies delivered.", remarks: "", timeSpent: "6 hrs" } },
  { code: "WK-2191", lead: "LD-1029", client: "cl-6", employee: "emp-1", title: "New Collection Landing Page", description: "Landing page for the new Navratri collection with a lookbook gallery.", service: "UI/UX Design", priority: "URGENT", deadlineIn: 7, status: "ASSIGNED", progress: 10, createdAgo: 1 },
];

export const projects = [
  { code: "PRJ-501", name: "ABC Agency - Brand Refresh", client: "cl-1", services: ["UI/UX Design", "Digital Marketing"], team: ["emp-1", "emp-4"], progress: 40, deadlineIn: 16, status: "Active", createdAgo: 10,
    tasks: [{ title: "Homepage wireframes", done: true, assignee: "emp-1" }, { title: "Homepage UI design", done: false, assignee: "emp-1" }, { title: "Instagram content calendar", done: true, assignee: "emp-4" }, { title: "Meta ads setup", done: false, assignee: "emp-4" }],
    comments: [{ author: "Admin", message: "Client wants a bolder red accent throughout." }] },
  { code: "PRJ-500", name: "Joshi Hospitals - Patient App", client: "cl-8", services: ["Mobile Application"], team: ["emp-8"], progress: 85, deadlineIn: 52, status: "Review", createdAgo: 14,
    tasks: [{ title: "Appointment booking flow", done: true, assignee: "emp-8" }, { title: "Doctor calendar sync", done: true, assignee: "emp-8" }, { title: "Push notifications", done: true, assignee: "emp-8" }, { title: "QA and release build", done: false, assignee: "emp-8" }] },
  { code: "PRJ-499", name: "Bansal Jewellers - Navratri Launch", client: "cl-6", services: ["UI/UX Design"], team: ["emp-1"], progress: 15, deadlineIn: 7, status: "Active", createdAgo: 1,
    tasks: [{ title: "Lookbook gallery design", done: false, assignee: "emp-1" }, { title: "Enquiry form", done: false, assignee: "emp-1" }] },
  { code: "PRJ-498", name: "Kapoor Builders - Launch Campaign", client: "cl-7", services: ["Outdoor Advertising"], team: ["emp-3"], progress: 80, deadlineIn: 5, status: "Review", createdAgo: 7,
    tasks: [{ title: "Hoarding creative x3", done: true, assignee: "emp-3" }, { title: "Client revision", done: false, assignee: "emp-3" }] },
  { code: "PRJ-497", name: "XYZ Pvt Ltd - HR Tool", client: "cl-2", services: ["Custom Software"], team: ["emp-8"], progress: 30, deadlineIn: 31, status: "Active", createdAgo: 6,
    tasks: [{ title: "Attendance module", done: true, assignee: "emp-8" }, { title: "Leave management module", done: false, assignee: "emp-8" }] },
  { code: "PRJ-496", name: "Iyer Finance - SIP Landing Page", client: "cl-5", services: ["Website"], team: ["emp-5"], progress: 100, deadlineIn: 4, status: "Completed", createdAgo: 27,
    tasks: [{ title: "Landing page build", done: true, assignee: "emp-5" }, { title: "CRM webhook integration", done: true, assignee: "emp-5" }] },
  { code: "PRJ-495", name: "Malhotra Motors - Diwali Campaign", client: "cl-3", services: ["Digital Marketing", "LED Screens"], team: ["emp-4"], progress: 20, deadlineIn: 6, status: "Planning", createdAgo: 2,
    tasks: [{ title: "Ad creative approval", done: false, assignee: "emp-4" }, { title: "Showroom targeting setup", done: false, assignee: "emp-4" }] },
  { code: "PRJ-494", name: "Nair Interiors - Brand Identity", client: "cl-4", services: ["Brand Strategy", "Event Management"], team: ["emp-3"], progress: 10, deadlineIn: 17, status: "On Hold", createdAgo: 4,
    tasks: [{ title: "Logo concepts", done: false, assignee: "emp-3" }],
    comments: [{ author: "Admin", message: "Client requested a one-week pause for budget approval." }] },
];

export const conversations = [
  { key: "conv-1", client: "cl-1", lead: "LD-1042", status: "New Leads", unreadCount: 2, online: true, lastSeen: "online", minutesAgo: 20,
    messages: [
      { dir: "inbound", text: "Hi, I need a new homepage for my e-commerce store.", minutesAgo: 120 },
      { dir: "outbound", text: "Hi Ravi! Happy to help. What service are you looking for - Website, UI/UX Design, or something else?", minutesAgo: 118 },
      { dir: "inbound", text: "UI/UX Design for our homepage", minutesAgo: 115 },
      { dir: "outbound", text: "Great choice! Could you share a bit more about your requirement?", minutesAgo: 113 },
      { dir: "inbound", text: "We want a modern, conversion-focused homepage, mobile-first. Budget is around 35-50k.", minutesAgo: 110 },
      { dir: "inbound", text: "reference-moodboard.jpg", type: "image", minutesAgo: 108 },
      { dir: "outbound", text: "Perfect, got it. Our team will review and get back with a proposal shortly.", minutesAgo: 100 },
      { dir: "inbound", text: "Sounds good, thank you!", minutesAgo: 25 },
      { dir: "inbound", text: "Sure, sending the reference links shortly.", minutesAgo: 20 },
    ] },
  { key: "conv-2", client: "cl-2", lead: "LD-1041", status: "New Leads", unreadCount: 0, online: false, lastSeen: "last seen today at 8:45 AM", minutesAgo: 240,
    messages: [
      { dir: "inbound", text: "Hello, do you build corporate websites?", minutesAgo: 300 },
      { dir: "outbound", text: "Yes! We would love to help. How many pages are you planning?", minutesAgo: 295 },
      { dir: "inbound", text: "About 5 pages - home, about, services, careers, contact.", minutesAgo: 250 },
      { dir: "inbound", text: "Okay, please share a quotation for the 5-page site.", minutesAgo: 240 },
    ] },
  { key: "conv-3", client: "cl-3", lead: "LD-1040", status: "Assigned", unreadCount: 0, employee: "emp-4", online: false, lastSeen: "last seen yesterday at 8:10 PM", minutesAgo: 1500,
    messages: [
      { dir: "inbound", text: "We want to run Diwali offers across all showrooms.", minutesAgo: 1600 },
      { dir: "outbound", text: "Assigned to Sandeep. Campaign starts tomorrow.", minutesAgo: 1500 },
    ] },
  { key: "conv-4", client: "cl-4", lead: "LD-1039", status: "Active", unreadCount: 1, employee: "emp-3", online: true, lastSeen: "online", minutesAgo: 400,
    messages: [
      { dir: "outbound", text: "Sharing the first moodboard for your studio identity.", minutesAgo: 420 },
      { dir: "inbound", text: "Loved the initial moodboard!", minutesAgo: 400 },
    ] },
  { key: "conv-5", client: "cl-6", lead: "LD-1029", status: "Active", unreadCount: 3, employee: "emp-1", online: false, lastSeen: "last seen 10 minutes ago", minutesAgo: 60,
    messages: [
      { dir: "inbound", text: "Hi, we spoke about the Navratri collection landing page.", minutesAgo: 200 },
      { dir: "outbound", text: "Yes! Rahul has been assigned and will start today.", minutesAgo: 90 },
      { dir: "inbound", text: "Great, it is a bit urgent - the festival is close.", minutesAgo: 80 },
      { dir: "inbound", text: "collection-catalogue.pdf", type: "document", minutesAgo: 70 },
      { dir: "inbound", text: "When can we expect the first draft?", minutesAgo: 60 },
    ] },
  { key: "conv-6", client: "cl-8", lead: "LD-1037", status: "Active", unreadCount: 0, employee: "emp-8", online: false, lastSeen: "last seen today at 6:40 PM", minutesAgo: 700,
    messages: [
      { dir: "outbound", text: "The build has been submitted for internal review.", minutesAgo: 720 },
      { dir: "inbound", text: "Great, the APK is under testing now.", minutesAgo: 700 },
    ] },
  { key: "conv-7", client: "cl-5", lead: "LD-1036", status: "Completed", unreadCount: 0, employee: "emp-5", online: false, lastSeen: "last seen 2 days ago", minutesAgo: 2880,
    messages: [
      { dir: "outbound", text: "Your landing page is live!", minutesAgo: 2900 },
      { dir: "inbound", text: "Thank you! The page looks great.", minutesAgo: 2880 },
    ] },
  { key: "conv-8", client: "cl-7", lead: "LD-1035", status: "Active", unreadCount: 1, employee: "emp-3", online: false, lastSeen: "last seen yesterday", minutesAgo: 1440,
    messages: [
      { dir: "outbound", text: "Sharing the first hoarding drafts for review.", minutesAgo: 1500 },
      { dir: "inbound", text: "Please use maroon and gold as discussed.", minutesAgo: 1440 },
    ] },
];

export const botFlow = [
  { order: 1, title: "Welcome Message", message: "Namaste! Welcome to Maa Ad Agency. What service do you need?", collectsField: "service",
    options: [{ label: "Website" }, { label: "Web Application" }, { label: "Mobile Application" }, { label: "UI/UX Design" }, { label: "Custom Software" }, { label: "Digital Marketing" }, { label: "Other" }] },
  { order: 2, title: "Requirement Prompt", message: "Great choice! What do you need exactly? Tell us in a few words.", collectsField: "requirement" },
  { order: 3, title: "Client Name", message: "Could you share your full name?", collectsField: "clientName" },
  { order: 4, title: "Company Name", message: "What is your company or business name?", collectsField: "company" },
  { order: 5, title: "Description", message: "Please describe your requirement in more detail.", collectsField: "description" },
  { order: 6, title: "Reference Website", message: "Do you have a reference website or design you like? (optional)", collectsField: "referenceWebsite" },
  { order: 7, title: "Deadline", message: "What is your expected deadline?", collectsField: "deadline" },
  { order: 8, title: "Budget", message: "What budget range are you planning for this project?", collectsField: "budget" },
  { order: 9, title: "Attachments", message: "You can share any reference files, logos or documents now.", collectsField: "attachments" },
  { order: 10, title: "Closing Message", message: "Thank you! Our team has received your requirement and will get back to you shortly." },
];

export const files = [
  { name: "requirement-brief.pdf", type: "pdf", category: "Client Files", client: "cl-8", project: "PRJ-500", uploadedBy: "Admin", size: "1.2 MB", daysAgo: 17 },
  { name: "app-release-build.apk", type: "other", category: "Project Files", client: "cl-8", project: "PRJ-500", uploadedBy: "Manoj Tiwari", size: "24 MB", daysAgo: 1 },
  { name: "home-screen.png", type: "image", category: "Screenshots", client: "cl-8", project: "PRJ-500", uploadedBy: "Manoj Tiwari", size: "340 KB", daysAgo: 1 },
  { name: "booking-flow.png", type: "image", category: "Screenshots", client: "cl-8", project: "PRJ-500", uploadedBy: "Manoj Tiwari", size: "310 KB", daysAgo: 1 },
  { name: "hoarding-draft-1.png", type: "image", category: "Designs", client: "cl-7", project: "PRJ-498", uploadedBy: "Priya Verma", size: "1.1 MB", daysAgo: 3 },
  { name: "brand-guideline.pdf", type: "pdf", category: "Documents", client: "cl-4", project: "PRJ-494", uploadedBy: "Admin", size: "2.4 MB", daysAgo: 4 },
  { name: "weekly-report-sep2.pdf", type: "pdf", category: "Employee Reports", client: "cl-1", project: "PRJ-501", uploadedBy: "Sandeep Yadav", size: "540 KB", daysAgo: 6 },
  { name: "logo-concepts.zip", type: "zip", category: "Designs", client: "cl-4", project: "PRJ-494", uploadedBy: "Priya Verma", size: "8.6 MB", daysAgo: 2 },
  { name: "sip-calculator-spec.docx", type: "doc", category: "Documents", client: "cl-5", project: "PRJ-496", uploadedBy: "Neha Singh", size: "220 KB", daysAgo: 25 },
  { name: "catalogue-wireframes.pdf", type: "pdf", category: "Project Files", client: "cl-6", project: "PRJ-499", uploadedBy: "Rahul Sharma", size: "1.8 MB", daysAgo: 0 },
  { name: "hr-tool-erd.png", type: "image", category: "Designs", client: "cl-2", project: "PRJ-497", uploadedBy: "Manoj Tiwari", size: "410 KB", daysAgo: 5 },
  { name: "health-camp-pamphlet.pdf", type: "pdf", category: "Client Files", client: "cl-8", uploadedBy: "Ankita Rao", size: "3.1 MB", daysAgo: 7 },
  { name: "monthly-report-ads.pdf", type: "pdf", category: "Employee Reports", client: "cl-1", project: "PRJ-501", uploadedBy: "Sandeep Yadav", size: "610 KB", daysAgo: 4 },
  { name: "reference-moodboard.jpg", type: "image", category: "Client Files", client: "cl-1", project: "PRJ-501", uploadedBy: "Ravi Mehta", size: "890 KB", daysAgo: 0 },
];

export const notifications = [
  { title: "New WhatsApp lead received", description: "ABC Agency asked about UI/UX Design for an e-commerce homepage.", category: "WhatsApp", read: false, minutesAgo: 20, href: "/master-admin/leads/LD-1042" },
  { title: "Rahul submitted work", description: "Navratri collection landing page - first draft ready for review.", category: "Work", read: false, minutesAgo: 90, href: "/master-admin/work/WK-2191" },
  { title: "Revision requested", description: "Kapoor Builders asked for a colour change on the hoarding creative.", category: "Work", read: false, minutesAgo: 2880, href: "/master-admin/work/WK-2200" },
  { title: "Deadline approaching", description: "Malhotra Motors - Diwali Campaign is due in 2 days.", category: "System", read: false, minutesAgo: 1440 },
  { title: "New client message", description: "Bansal Jewellers: When can we expect the first draft?", category: "WhatsApp", read: true, minutesAgo: 60, href: "/master-admin/whatsapp" },
  { title: "Employee completed task", description: "Ankita Rao marked Health Camp Pamphlets as completed.", category: "Work", read: true, minutesAgo: 10080, href: "/master-admin/work/WK-2192" },
  { title: "New WhatsApp lead received", description: "XYZ Pvt Ltd is interested in a 5-page corporate website.", category: "WhatsApp", read: true, minutesAgo: 240, href: "/master-admin/leads/LD-1041" },
  { title: "Work approved", description: "Instagram Growth Campaign for ABC Agency was approved.", category: "Work", read: true, minutesAgo: 5760, href: "/master-admin/work/WK-2195" },
  { title: "System backup completed", description: "Nightly database backup finished successfully.", category: "System", read: true, minutesAgo: 600 },
  { title: "New employee onboarded", description: "Manoj Tiwari joined as Backend Developer.", category: "System", read: true, minutesAgo: 20160 },
];
