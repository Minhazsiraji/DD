export const M6D_COMMAND_ALIASES = {
  pause: [
    "pause", "pause voice", "hold", "stop for a moment", "পজ", "বিরতি", "একটু থামো", "একটু থামুন", "pause koro",
  ],
  resume: [
    "resume", "continue", "continue voice", "resume voice", "start again", "চালিয়ে যাও", "চালিয়ে যাও", "আবার শুরু", "আবার শুরু করো", "চালু করো", "resume koro",
  ],
  end: [
    "end", "stop", "end voice", "stop voice", "stop listening", "voice off", "শেষ", "শেষ করো", "বন্ধ করো", "ভয়েস বন্ধ করো", "ভয়েস বন্ধ করো", "voice bondho koro",
  ],
  undo: [
    "undo", "undo last", "undo last sentence", "undo last change", "cancel last change", "go back last change", "বাতিল", "আগেরটা বাতিল", "শেষটা ফেরত", "শেষ পরিবর্তন বাতিল", "শেষ বাক্য undo", "last change undo koro",
  ],
  removeLastSentence: [
    "remove last sentence", "delete last sentence", "remove last line", "delete last line", "erase last sentence", "erase last line", "শেষ বাক্য মুছো", "শেষ লাইন মুছো", "শেষ কথাটা মুছো", "শেষ বাক্য বাদ দাও", "last sentence delete koro",
  ],
  clear: [
    "clear current section", "clear this section", "clear section", "clear field", "clear this field", "clear note", "এই সেকশন clear", "এই সেকশন মুছো", "এই অংশ মুছো", "এই ঘর খালি করো", "নোট মুছো", "field clear koro",
  ],
  read: [
    "read current section", "read this section", "read section", "read field", "read note", "এই সেকশন পড়ো", "এই অংশ পড়ো", "এই ঘর পড়ো", "নোট পড়ো",
  ],
  next: ["next", "next section", "next field", "পরের সেকশন", "পরের অংশ", "পরের ঘর"],
  previous: ["previous", "previous section", "previous field", "back", "আগের সেকশন", "আগের অংশ", "আগের ঘর", "পেছনে যাও"],
  diagnosisNavigate: [
    "diagnosis", "diagnoses", "ডায়াগনোসিস", "ডায়াগনোসিস", "রোগ নির্ণয়", "রোগ নির্ণয়", "নির্ণয়", "নির্ণয়", "diagnosis e jao",
  ],
  diagnosisTitle: [
    "diagnosis field", "diagnosis name", "diagnosis title", "ডায়াগনোসিস ফিল্ড", "ডায়াগনোসিস ফিল্ড", "রোগ নির্ণয়ের ঘর", "রোগ নির্ণয়ের ঘর",
  ],
  diagnosisCertainty: [
    "how certain", "certainty", "certainty level", "how sure", "কতটা নিশ্চিত", "নিশ্চিততা", "নিশ্চিততার মাত্রা",
  ],
  diagnosisNote: [
    "note", "note field", "note section", "diagnosis note", "diagnosis notes", "diagnosis comments", "নোট", "নোট ফিল্ড", "নোট সেকশন", "ডায়াগনোসিস নোট", "ডায়াগনোসিস নোট", "diagnosis note e jao",
  ],
  provisional: ["provisional", "সম্ভাব্য", "প্রভিশনাল"],
  working: ["working", "working diagnosis", "ওয়ার্কিং", "ওয়ার্কিং", "কার্যকর ধারণা"],
  confirmed: ["confirmed", "confirm", "নিশ্চিত", "কনফার্মড"],
  ruledOut: ["ruled out", "rule out", "rooted out", "excluded", "বাদ", "বাতিল", "রুলড আউট"],
  diagnosisReview: ["save diagnosis", "confirm diagnosis", "add diagnosis", "ডায়াগনোসিস সেভ", "রোগ নির্ণয় যোগ করো"],
  investigationNavigate: [
    "investigation", "investigations", "investigation order", "investigation orders", "test", "tests", "test order", "test orders", "ইনভেস্টিগেশন", "ইনভেস্টিগেশন অর্ডার", "ইনভেস্টিগেশন অর্ডার্স", "পরীক্ষার অর্ডার", "টেস্ট", "টেস্ট অর্ডার", "investigation e jao",
  ],
  investigationField: [
    "investigation field", "investigation search", "search investigation", "test field", "test search", "ইনভেস্টিগেশন ফিল্ড", "ইনভেস্টিগেশন সার্চ", "টেস্ট ফিল্ড", "টেস্ট সার্চ",
  ],
} as const;

export const M6D_SECTION_ALIASES = {
  chiefComplaints: [
    "chief complaint", "chief complaints", "complaint", "complaints", "cheap complaint", "cheap complaints", "প্রধান অভিযোগ", "মূল অভিযোগ", "অভিযোগ", "chief complaint e jao",
  ],
  presentIllness: [
    "history", "present illness", "history of present illness", "hpi", "হিস্ট্রি", "ইতিহাস", "বর্তমান অসুস্থতার ইতিহাস", "বর্তমান রোগের ইতিহাস", "history e jao",
  ],
  pastHistory: [
    "past history", "past medical history", "previous medical history", "medical history", "previous illness history", "অতীত ইতিহাস", "পূর্ব ইতিহাস", "আগের রোগের ইতিহাস", "পূর্ববর্তী রোগের ইতিহাস", "past history e jao",
  ],
  examination: [
    "examination", "exam", "physical examination", "clinical examination", "পরীক্ষা", "শারীরিক পরীক্ষা", "ক্লিনিক্যাল পরীক্ষা", "examination e jao",
  ],
  assessment: [
    "assessment", "impression", "clinical impression", "অ্যাসেসমেন্ট", "মূল্যায়ন", "মূল্যায়ন", "ধারণা", "assessment e jao",
  ],
  advice: [
    "advice", "plan", "treatment advice", "পরামর্শ", "উপদেশ", "advice e jao",
  ],
  nextVisitNote: [
    "follow up", "follow-up", "followup", "follow up note", "next visit", "next visit note", "next appointment", "review", "review visit", "ফলো আপ", "ফলোআপ", "পরবর্তী ভিজিট", "পরবর্তী সাক্ষাৎ", "follow up e jao",
  ],
} as const;
