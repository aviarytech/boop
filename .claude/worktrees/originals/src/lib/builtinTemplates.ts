/**
 * Built-in list templates that are always available.
 * Users can also create their own templates from existing lists.
 */

export interface BuiltinTemplateItem {
  name: string;
  description?: string;
  priority?: "high" | "medium" | "low";
  order: number;
}

export interface BuiltinTemplate {
  id: string;
  name: string;
  emoji: string;
  description: string;
  items: BuiltinTemplateItem[];
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: "grocery",
    name: "Grocery List",
    emoji: "🛒",
    description: "Common grocery items to get you started",
    items: [
      { name: "Milk", order: 0 },
      { name: "Eggs", order: 1 },
      { name: "Bread", order: 2 },
      { name: "Butter", order: 3 },
      { name: "Cheese", order: 4 },
      { name: "Fruits", order: 5 },
      { name: "Vegetables", order: 6 },
      { name: "Chicken/Meat", order: 7 },
      { name: "Rice/Pasta", order: 8 },
      { name: "Snacks", order: 9 },
    ],
  },
  {
    id: "packing",
    name: "Packing Checklist",
    emoji: "🧳",
    description: "Essential items for your next trip",
    items: [
      { name: "Passport/ID", priority: "high", order: 0 },
      { name: "Phone charger", priority: "high", order: 1 },
      { name: "Toiletries", order: 2 },
      { name: "Medications", priority: "high", order: 3 },
      { name: "Clothes (underwear, socks)", order: 4 },
      { name: "Outerwear/jacket", order: 5 },
      { name: "Shoes", order: 6 },
      { name: "Laptop/tablet", order: 7 },
      { name: "Headphones", order: 8 },
      { name: "Sunglasses", order: 9 },
      { name: "Wallet/cards", priority: "high", order: 10 },
      { name: "Travel pillow", order: 11 },
    ],
  },
  {
    id: "weekly-tasks",
    name: "Weekly Tasks",
    emoji: "📅",
    description: "Common weekly chores and activities",
    items: [
      { name: "Grocery shopping", order: 0 },
      { name: "Laundry", order: 1 },
      { name: "Clean bathroom", order: 2 },
      { name: "Vacuum/mop floors", order: 3 },
      { name: "Take out trash", order: 4 },
      { name: "Meal prep", order: 5 },
      { name: "Exercise (3x)", priority: "medium", order: 6 },
      { name: "Review budget", order: 7 },
      { name: "Call family/friends", order: 8 },
    ],
  },
  {
    id: "project-kickoff",
    name: "Project Kickoff",
    emoji: "🚀",
    description: "Get your new project started right",
    items: [
      { name: "Define project goals", priority: "high", order: 0 },
      { name: "Identify stakeholders", priority: "high", order: 1 },
      { name: "Set timeline/milestones", priority: "high", order: 2 },
      { name: "Create project repo/workspace", order: 3 },
      { name: "Write initial documentation", order: 4 },
      { name: "Set up communication channel", order: 5 },
      { name: "Schedule kickoff meeting", order: 6 },
      { name: "Assign initial tasks", order: 7 },
      { name: "Define success metrics", priority: "medium", order: 8 },
    ],
  },
  {
    id: "moving",
    name: "Moving Checklist",
    emoji: "📦",
    description: "Everything you need for a smooth move",
    items: [
      { name: "Update address (mail, subscriptions)", priority: "high", order: 0 },
      { name: "Transfer utilities", priority: "high", order: 1 },
      { name: "Pack room by room", order: 2 },
      { name: "Label all boxes", order: 3 },
      { name: "Hire movers or rent truck", priority: "high", order: 4 },
      { name: "Clean old place", order: 5 },
      { name: "Get new keys", priority: "high", order: 6 },
      { name: "Set up internet/cable", order: 7 },
      { name: "Update driver's license", order: 8 },
      { name: "Notify bank/employers", order: 9 },
    ],
  },
  {
    id: "party-planning",
    name: "Party Planning",
    emoji: "🎉",
    description: "Plan the perfect celebration",
    items: [
      { name: "Set date and time", priority: "high", order: 0 },
      { name: "Create guest list", priority: "high", order: 1 },
      { name: "Send invitations", order: 2 },
      { name: "Plan menu/food", order: 3 },
      { name: "Order cake", order: 4 },
      { name: "Buy drinks", order: 5 },
      { name: "Get decorations", order: 6 },
      { name: "Create playlist", order: 7 },
      { name: "Plan activities/games", order: 8 },
      { name: "Set up day before", order: 9 },
    ],
  },
];
