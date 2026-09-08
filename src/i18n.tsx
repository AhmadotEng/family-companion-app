import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type AppLanguage = 'en' | 'ar';

const STORAGE_KEY = 'ailah-language';

const translations = {
  'Home': 'الرئيسية',
  'Dashboard': 'الرئيسية',
  'Family': 'العائلة',
  'Gatherings': 'التجمعات',
  'Memories': 'الذكريات',
  'Activities': 'الأنشطة',
  'Rewards': 'المكافآت',
  'SILAH': 'صِلَة',
  'Account': 'الحساب',
  'Profile and account': 'الملف الشخصي والحساب',
  'Privacy and location': 'الخصوصية والموقع',
  'Sign out': 'تسجيل الخروج',
  'English': 'English',
  'Arabic': 'العربية',
  'Welcome back': 'مرحباً بعودتك',
  'Create your family space': 'أنشئ مساحة عائلتك',
  'Sign in': 'تسجيل الدخول',
  'Register': 'إنشاء حساب',
  'Your name': 'اسمك',
  'Family space name': 'اسم مساحة العائلة',
  'Email': 'البريد الإلكتروني',
  'Password': 'كلمة المرور',
  'Sign in securely': 'تسجيل الدخول',
  'Create private space': 'إنشاء مساحة العائلة',
  'Sign in to continue to your family space.': 'سجّل الدخول للمتابعة إلى مساحة عائلتك.',
  'Create one shared place for your family tree, gatherings and memories.': 'أنشئ مكاناً واحداً يجمع شجرة العائلة والتجمعات والذكريات.',
  'Your family story,': 'قصة عائلتك،',
  'kept together.': 'تبقى مجتمعة.',
  'One shared place for your family tree, gatherings, activities and favorite moments.': 'مكان واحد يجمع شجرة العائلة والتجمعات والأنشطة واللحظات المفضلة.',
  'Private, account-protected family data': 'بيانات عائلية خاصة ومحمية',
  'Relationships stored as a consistent family graph': 'روابط عائلية منظمة في شجرة واحدة',
  'Marhaba': 'مرحباً',
  'Your family, all in one place': 'عائلتك، كلها في مكان واحد',
  'AI family planning': 'تخطيط عائلي ذكي',
  'Plan family time with a helping hand.': 'خطّط لوقت عائلي أجمل بمساعدة صِلَة.',
  'Open SILAH': 'افتح صِلَة',
  'Open Family Tree': 'افتح شجرة العائلة',
  'Family members': 'أفراد العائلة',
  'recorded': 'مسجلون',
  'Manage': 'إدارة',
  'Upcoming gatherings': 'التجمعات القادمة',
  'Open calendar': 'فتح التقويم',
  'No family members are visible yet.': 'لا يوجد أفراد في شجرة العائلة حتى الآن.',
  'No upcoming gathering has been saved.': 'لم يتم حفظ أي تجمع قادم بعد.',
  'Plan a gathering': 'خطّط لتجمع',
  'Family profile': 'ملف فرد العائلة',
  'Birthday': 'تاريخ الميلاد',
  'Location': 'الموقع',
  'Interests': 'الاهتمامات',
  'Notes': 'ملاحظات',
  'Ask SILAH': 'اسأل صِلَة',
  'Private family archive': 'ألبوم العائلة',
  'Your family memories, gathered by occasion.': 'ذكريات عائلتك مرتبة حسب المناسبة.',
  'Add memory': 'إضافة ذكرى',
  'Refresh archive': 'تحديث الذكريات',
  'Close form': 'إغلاق النموذج',
  'New memory': 'ذكرى جديدة',
  'What would you like to preserve?': 'ما الذكرى التي تود حفظها؟',
  'Gathering': 'التجمع',
  'Select a gathering': 'اختر تجمعاً',
  'Memory type': 'نوع الذكرى',
  'Written': 'نص',
  'Preserve a family story': 'احفظ قصة عائلية',
  'Photo': 'صورة',
  'JPEG, PNG or WebP': 'JPEG أو PNG أو WebP',
  'Video': 'فيديو',
  'MP4, up to 15 MB': 'MP4، بحد أقصى ١٥ ميغابايت',
  'Audio': 'تسجيل صوتي',
  'MP3, M4A or WebM': 'MP3 أو M4A أو WebM',
  'Title': 'العنوان',
  'Captured at': 'تاريخ الذكرى',
  'Written memory': 'نص الذكرى',
  'Friday family story': 'حكاية عائلية يوم الجمعة',
  'Write the story in your own words…': 'اكتب القصة بكلماتك…',
  'Caption (optional)': 'تعليق (اختياري)',
  'Private media file': 'ملف الوسائط',
  'Who can view this?': 'من يمكنه مشاهدة هذه الذكرى؟',
  'Only me': 'أنا فقط',
  'Family administrators': 'مشرفو العائلة',
  'Whole family': 'كل العائلة',
  'Selected family members': 'أفراد محددون من العائلة',
  'Only the person saving this memory can open it.': 'أنت وحدك تستطيع مشاهدة هذه الذكرى.',
  'You and family owners or administrators can view it.': 'يمكنك أنت ومشرفو العائلة مشاهدتها.',
  'Every signed-in member of this family can view it.': 'يمكن لكل أفراد العائلة مشاهدتها.',
  'Only you and the people selected below can view it.': 'يمكنك أنت والأشخاص الذين تحددهم فقط مشاهدتها.',
  'Cancel': 'إلغاء',
  'Save memory': 'حفظ الذكرى',
  'Saving…': 'جارٍ الحفظ…',
  'Family memories': 'ذكريات العائلة',
  'No memories made yet': 'لم نصنع ذكريات بعد',
  'Start your family album by adding a favorite moment.': 'ابدأ ألبوم العائلة بإضافة لحظة مميزة.',
  'View album': 'عرض الألبوم',
  'Previous memories': 'ذكريات سابقة',
  'Open an album to revisit the photos and stories.': 'افتح ألبوماً لتستعيد الصور والقصص.',
  'My added memories': 'ذكرياتي المضافة',
  'Saved on this device': 'محفوظة على هذا الجهاز',
  'Family album': 'ألبوم العائلة',
  'Grandparents’ Day at Qasr Al Hosn': 'يوم الأجداد في قصر الحصن',
  'Family Museum Morning': 'صباح العائلة في المتحف',
  'Cousins’ Picnic': 'نزهة أبناء العمومة',
  'Three generations together': 'ثلاثة أجيال معاً',
  'Under the dome': 'تحت القبة',
  'A long afternoon together': 'أمسية عائلية طويلة',
  'Qasr Al Hosn, Abu Dhabi': 'قصر الحصن، أبوظبي',
  'Louvre Abu Dhabi': 'اللوفر أبوظبي',
  'Al Noor Island, Sharjah': 'جزيرة النور، الشارقة',
  'Grandfather showed the children where Abu Dhabi’s story began, then shared memories from his childhood.': 'عرّف الجد الأطفال بالمكان الذي بدأت منه قصة أبوظبي، ثم شاركهم ذكريات طفولته.',
  'Everyone chose one artwork to remember. The children loved the moving patterns of light most of all.': 'اختار كل فرد عملاً فنياً ليتذكره، وأحب الأطفال أنماط الضوء المتحركة أكثر شيء.',
  'A simple picnic turned into hours of stories, games and plans for the next family day.': 'تحولت النزهة البسيطة إلى ساعات من القصص والألعاب والتخطيط لليوم العائلي القادم.',
  'Your memory was saved and added to the family album.': 'تم حفظ ذكراك وإضافتها إلى ألبوم العائلة.',
  'Curated for family time': 'اقتراحات لوقت عائلي أجمل',
  'Find a place everyone will enjoy.': 'اكتشف مكاناً يستمتع به الجميع.',
  'Choose an activity everyone can enjoy, then plan it with SILAH or build the gathering yourself.': 'اختر نشاطاً يناسب الجميع، ثم خطّط له مع صِلَة أو أنشئ التجمع بنفسك.',
  'Search activities': 'ابحث عن نشاط',
  'Filters': 'الفلاتر',
  'Emirate': 'الإمارة',
  'Category': 'الفئة',
  'Budget': 'اقتصادي',
  'Price range': 'الميزانية',
  'Elder-friendly': 'مناسب لكبار السن',
  'Clear all': 'مسح الكل',
  'Plan with SILAH': 'خطّط مع صِلَة',
  'Plan manually': 'خطّط بنفسك',
  'Loading catalog…': 'جارٍ تحميل الأنشطة…',
  'No activities match these filters.': 'لا توجد أنشطة تطابق هذه الفلاتر.',
  'Qasr Al Hosn Family Heritage Walk': 'جولة عائلية في قصر الحصن',
  'Louvre Abu Dhabi Family Visit': 'زيارة عائلية إلى اللوفر أبوظبي',
  'Al Noor Island Family Picnic': 'نزهة عائلية في جزيرة النور',
  'Al Fahidi Family Storytelling Majlis': 'مجلس الحكايات العائلية في الفهيدي',
  'Qasr Al Hosn': 'قصر الحصن',
  'Al Noor Island': 'جزيرة النور',
  'Al Fahidi Historical Neighbourhood': 'حي الفهيدي التاريخي',
  'Culture': 'ثقافة',
  'Museums': 'متاحف',
  'Outdoors': 'أماكن خارجية',
  'Free': 'مجاني',
  'Premium': 'مميز',
  'All': 'الكل',
  'Abu Dhabi': 'أبوظبي',
  'Dubai': 'دبي',
  'Sharjah': 'الشارقة',
  '2 hours': 'ساعتان',
  '2–3 hours': 'ساعتان إلى ثلاث ساعات',
  '3 hours': 'ثلاث ساعات',
  '90 minutes': '٩٠ دقيقة',
  'Elder-friendly note': 'مناسب لكبار السن',
  'Explore Abu Dhabi’s historic landmark together, with shaded rest stops and plenty of moments for grandparents to share family stories.': 'اكتشفوا معاً أحد أهم معالم أبوظبي التاريخية، مع أماكن مظللة للراحة وفرص كثيرة ليشارك الأجداد قصص العائلة.',
  'Enjoy an easy-paced museum day under the iconic dome, choosing a few favorite artworks to discuss over coffee afterward.': 'استمتعوا بزيارة هادئة للمتحف تحت القبة الشهيرة، واختاروا أعمالكم المفضلة للحديث عنها بعد الجولة.',
  'Share a relaxed picnic surrounded by gardens, art and lagoon views, with space for children to explore and elders to unwind.': 'استمتعوا بنزهة مريحة بين الحدائق والفنون وإطلالات البحيرة، مع مساحة للأطفال للاستكشاف وكبار السن للاسترخاء.',
  'Walk through the traditional lanes, then pause in a courtyard to share family stories and memories across generations.': 'تجولوا في الأزقة التراثية ثم اجتمعوا في فناء لتبادل قصص العائلة وذكرياتها بين الأجيال.',
  '18 January 2026': '١٨ يناير ٢٠٢٦',
  '12 April 2026': '١٢ أبريل ٢٠٢٦',
  '24 May 2026': '٢٤ مايو ٢٠٢٦',
  'Family Tree': 'شجرة العائلة',
  'Digital family tree of': 'شجرة عائلة',
  'Add relative': 'إضافة قريب',
  'Search family tree': 'ابحث في شجرة العائلة',
  'Search family': 'ابحث في العائلة',
  'Tree': 'الشجرة',
  'List': 'القائمة',
  'Fit': 'ملاءمة',
  'Me': 'أنا',
  'person': 'فرد',
  'people': 'أفراد',
  'in your Family tree': 'في شجرة عائلتك',
  'Focused person': 'الشخص المحدد',
  'Details': 'التفاصيل',
  'Profile photo': 'الصورة الشخصية',
  'Upload': 'رفع صورة',
  'Camera': 'الكاميرا',
  'Anonymous': 'صورة افتراضية',
  'Private media storage is not connected yet': 'رفع الصور غير متاح حالياً',
  'Private media storage is the next milestone; no photo is uploaded locally.': 'يمكنك استخدام الصورة الافتراضية الآن، وسيُتاح رفع الصور لاحقاً.',
  'Add relative to tree': 'إضافة قريب إلى الشجرة',
  'Full name': 'الاسم الكامل',
  'Relationship to': 'صلة القرابة مع',
  'Type of link (lineage connection)': 'نوع صلة القرابة',
  'Other parent': 'الوالد الآخر',
  'Birthday date': 'تاريخ الميلاد',
  'Contact information': 'معلومات التواصل',
  'Approximate emirate': 'الإمارة التقريبية',
  'Primary note': 'ملاحظة',
  'Add to family': 'إضافة إلى العائلة',
  'Father': 'الأب',
  'Mother': 'الأم',
  'Son': 'الابن',
  'Daughter': 'الابنة',
  'Brother': 'الأخ',
  'Sister': 'الأخت',
  'Spouse': 'الزوج أو الزوجة',
  'Sibling': 'الأخ أو الأخت',
  'Not provided': 'غير محدد',
  'Ajman': 'عجمان',
  'Umm Al Quwain': 'أم القيوين',
  'Ras Al Khaimah': 'رأس الخيمة',
  'Fujairah': 'الفجيرة',
  'Admin-reported area; not device tracking.': 'موقع تقريبي يدخله المشرف.',
  'e.g. Zayed Al Mansouri': 'مثال: زايد المنصوري',
  'e.g. Traditional poetry reader': 'مثال: يحب الشعر النبطي',
  'Send WhatsApp form': 'إرسال نموذج عبر واتساب',
  'A relative does not use the app?': 'قريبك لا يستخدم التطبيق؟',
  'Share a simple form in WhatsApp so a relative can reply without installing the app.': 'أرسل نموذجاً بسيطاً عبر واتساب ليجيب قريبك من دون تثبيت التطبيق.',
  'Agenda': 'الأجندة',
  'Month': 'الشهر',
  'Today': 'اليوم',
  'Su': 'ح',
  'Mo': 'ن',
  'Tu': 'ث',
  'We': 'ر',
  'Th': 'خ',
  'Fr': 'ج',
  'Sa': 'س',
  'Selected date': 'التاريخ المحدد',
  'Create gathering': 'إنشاء تجمع',
  'Bring everyone together': 'اجمع العائلة في مناسبة جميلة',
  'Create a gathering, choose who to invite, and track RSVPs in one place.': 'أنشئ تجمعاً، واختر المدعوين، وتابع الردود في مكان واحد.',
  'No gathering planned for this day.': 'لا يوجد تجمع مخطط لهذا اليوم.',
  'Prepare RSVP links': 'تجهيز روابط الدعوة',
  'Copy link': 'نسخ الرابط',
  'Copied': 'تم النسخ',
  'Preview': 'معاينة',
  'Family members who use AILAH will also receive an in-app RSVP notification.': 'سيتلقى أفراد العائلة الذين يستخدمون AILAH إشعاراً داخل التطبيق للرد على الدعوة.',
  'Coming up': 'القادم',
  'No later gatherings are scheduled.': 'لا توجد تجمعات أخرى مجدولة.',
  'Plan Gathering': 'تخطيط تجمع',
  'Plan gathering': 'خطّط لتجمع',
  'Asia/Dubai timezone': 'توقيت دبي',
  'Purpose': 'الهدف',
  'Date': 'التاريخ',
  'Dubai time': 'توقيت دبي',
  'Type': 'النوع',
  'Notes (optional)': 'ملاحظات (اختياري)',
  'Friday family dinner': 'عشاء العائلة يوم الجمعة',
  'Reconnect after a busy month': 'لقاء عائلي بعد شهر حافل',
  'Family home, Abu Dhabi': 'منزل العائلة، أبوظبي',
  'Accessibility, food, or arrival details': 'تفاصيل الوصول أو الطعام أو الاحتياجات الخاصة',
  'Family gathering': 'تجمع عائلي',
  'Majlis': 'مجلس',
  'Meal': 'وجبة عائلية',
  'Outdoor activity': 'نشاط خارجي',
  'Celebration': 'احتفال',
  'Visit': 'زيارة',
  'Phone call': 'مكالمة هاتفية',
  'Video call': 'مكالمة فيديو',
  'Nothing is saved or shared until you review and confirm.': 'لن يتم حفظ أو مشاركة أي شيء قبل المراجعة والتأكيد.',
  'The location is a planning label only. Its existence, hours, availability, accessibility, and suitability have not been verified.': 'راجع موقع النشاط ومواعيده ومدى ملاءمته قبل الزيارة.',
  'People to invite (optional)': 'المدعوون (اختياري)',
  'Search invitees': 'ابحث في المدعوين',
  'Search family members': 'ابحث عن أفراد العائلة',
  'Review before saving': 'مراجعة قبل الحفظ',
  'Invitation links': 'روابط الدعوة',
  'Gathering saved': 'تم حفظ التجمع',
  'Select people who should receive a new private RSVP link.': 'اختر من تريد إرسال رابط الدعوة الخاص إليه.',
  'Review': 'مراجعة',
  'Back': 'رجوع',
  'Confirm & prepare': 'تأكيد وتجهيز',
  'Done': 'تم',
  'Private family support': 'مساعد عائلي خاص',
  'How can I help your family today?': 'كيف يمكنني مساعدة عائلتك اليوم؟',
  'How it works': 'كيف تعمل صِلَة؟',
  'Try an example': 'جرّب مثالاً',
  'Stored reconnection plans': 'خطط التواصل المحفوظة',
  'stored': 'محفوظة',
  'Send this request to Google Gemini': 'إرسال هذا الطلب إلى Google Gemini',
  'One-time approval for this message': 'موافقة لمرة واحدة لهذه الرسالة',
  'Read details': 'قراءة التفاصيل',
  'Hide details': 'إخفاء التفاصيل',
  'Delete conversation': 'حذف المحادثة',
  'Ask the family agent': 'اسأل صِلَة',
  'You': 'أنت',
  'Marhaba, I’m SILAH. I can help you plan gatherings, find family activities, add relatives, and organize memories. What would you like to do together?': 'مرحباً، أنا صِلَة. أساعدك في تخطيط التجمعات، واختيار الأنشطة العائلية، وإضافة الأقارب، وتنظيم الذكريات. ماذا تود أن نفعل معاً؟',
  'Add my brother Khaled, born 1985-04-12.': 'أضف أخي خالد، مواليد 1985-04-12.',
  'Create a gathering draft for a family dinner tomorrow at 7 PM.': 'أنشئ مسودة تجمع لعشاء عائلي غداً الساعة 7 مساءً.',
  'Prepare RSVP links for my next gathering.': 'جهّز روابط تأكيد الحضور لتجمعي القادم.',
  'Complete the past gathering using its Going RSVPs.': 'أكمل التجمع السابق باستخدام ردود الحضور.',
  'Save a private written memory for my completed gathering.': 'احفظ ذكرى مكتوبة خاصة لتجمعي المكتمل.',
  'Mark my latest reconnection plan as accepted.': 'سجّل موافقتي على أحدث خطة تواصل.',
  'Remove Khaled from the family tree.': 'احذف خالد من شجرة العائلة.',
  'Update my birth date to 1985-04-12.': 'حدّث تاريخ ميلادي إلى 1985-04-12.',
  'Prepare invitation links for a gathering I created.': 'جهّز روابط دعوة لتجمع أنشأته.',
  'Create a gentle reconnection plan for me and a relative.': 'أنشئ خطة تواصل لطيفة بيني وبين أحد الأقارب.',
  'Ask SILAH…': 'اسأل صِلَة…',
  'Send request': 'إرسال الطلب',
  'Profile': 'الملف الشخصي',
  'Privacy and safety': 'الخصوصية والأمان',
  'Language': 'اللغة',
  'Notifications': 'الإشعارات',
  'Family settings': 'إعدادات العائلة',
  'Help and support': 'المساعدة والدعم',
} as const;

type TranslationKey = keyof typeof translations;

const reverseTranslations = new Map<string, string>(Object.entries(translations).map(([english, arabic]) => [arabic, english]));

function translateDynamic(value: string, language: AppLanguage): string | undefined {
  if (language === 'ar') {
    const patterns: Array<[RegExp, (...matches: string[]) => string]> = [
      [/^(\d+) results?$/, count => `${count} نتيجة`],
      [/^(\d+) visible to you$/, count => `${count} ظاهرة لك`],
      [/^(\d+) going$/, count => `${count} سيحضرون`],
      [/^Next (\d+)$/, count => `القادمة: ${count}`],
      [/^(\d+) invited$/, count => `${count} مدعوون`],
      [/^(\d+) people in your Family tree$/, count => `${count} أفراد في شجرة عائلتك`],
      [/^(\d+) person in your Family tree$/, count => `${count} فرد في شجرة عائلتك`],
      [/^(\d+) albums$/, count => `${count} ألبومات`],
      [/^(\d+) memories$/, count => `${count} ذكريات`],
      [/^(\d+) memory$/, count => `${count} ذكرى`],
      [/^(\d+) family members? available to invite from your Family Tree\.$/, count => `${count} من أفراد العائلة متاحون للدعوة من شجرة العائلة.`],
    ];
    for (const [pattern, replacement] of patterns) {
      const match = value.match(pattern);
      if (match) return replacement(...match.slice(1));
    }
  }
  else {
    const patterns: Array<[RegExp, (...matches: string[]) => string]> = [
      [/^(\d+) نتيجة$/, count => `${count} results`],
      [/^(\d+) ظاهرة لك$/, count => `${count} visible to you`],
      [/^(\d+) سيحضرون$/, count => `${count} going`],
      [/^القادمة: (\d+)$/, count => `Next ${count}`],
      [/^(\d+) مدعوون$/, count => `${count} invited`],
      [/^(\d+) ألبومات$/, count => `${count} albums`],
      [/^(\d+) ذكريات$/, count => `${count} memories`],
      [/^(\d+) ذكرى$/, count => `${count} memory`],
    ];
    for (const [pattern, replacement] of patterns) {
      const match = value.match(pattern);
      if (match) return replacement(...match.slice(1));
    }
  }
  return undefined;
}

function translateValue(value: string, language: AppLanguage): string {
  const trimmed = value.trim();
  if (!trimmed) return value;
  const translated = language === 'ar'
    ? translations[trimmed as TranslationKey] ?? translateDynamic(trimmed, language)
    : reverseTranslations.get(trimmed);
  if (!translated || translated === trimmed) return value;
  const leading = value.match(/^\s*/)?.[0] ?? '';
  const trailing = value.match(/\s*$/)?.[0] ?? '';
  return `${leading}${translated}${trailing}`;
}

interface LanguageContextValue {
  language: AppLanguage;
  direction: 'ltr' | 'rtl';
  setLanguage: (language: AppLanguage) => void;
  toggleLanguage: () => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'en',
  direction: 'ltr',
  setLanguage: () => undefined,
  toggleLanguage: () => undefined,
  t: key => key,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(() => (
    typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_KEY) === 'ar' ? 'ar' : 'en'
  ));

  const setLanguage = useCallback((nextLanguage: AppLanguage) => {
    window.localStorage.setItem(STORAGE_KEY, nextLanguage);
    setLanguageState(nextLanguage);
  }, []);
  const toggleLanguage = useCallback(() => setLanguage(language === 'en' ? 'ar' : 'en'), [language, setLanguage]);
  const t = useCallback((key: string) => (
    language === 'ar' ? translations[key as TranslationKey] ?? key : reverseTranslations.get(key) ?? key
  ), [language]);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    document.body.dataset.language = language;

    const localizeElement = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) {
        const node = root as Text;
        const parent = node.parentElement;
        if (parent && !['SCRIPT', 'STYLE'].includes(parent.tagName) && !parent.closest('[data-no-localize]')) {
          const nextValue = translateValue(node.nodeValue ?? '', language);
          if (nextValue !== node.nodeValue) node.nodeValue = nextValue;
        }
        return;
      }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      let current = walker.nextNode();
      while (current) {
        const parent = current.parentElement;
        if (parent && !['SCRIPT', 'STYLE'].includes(parent.tagName) && !parent.closest('[data-no-localize]')) {
          nodes.push(current as Text);
        }
        current = walker.nextNode();
      }
      nodes.forEach(node => {
        const nextValue = translateValue(node.nodeValue ?? '', language);
        if (nextValue !== node.nodeValue) node.nodeValue = nextValue;
      });

      if (root instanceof Element) {
        [root, ...Array.from(root.querySelectorAll('*'))].forEach(element => {
          if (element.closest('[data-no-localize]')) return;
          ['placeholder', 'aria-label', 'title'].forEach(attribute => {
            const value = element.getAttribute(attribute);
            if (!value) return;
            const nextValue = translateValue(value, language);
            if (nextValue !== value) element.setAttribute(attribute, nextValue);
          });
        });
      }
    };

    localizeElement(document.body);
    const observer = new MutationObserver(records => {
      records.forEach(record => {
        if (record.type === 'characterData') localizeElement(record.target);
        record.addedNodes.forEach(localizeElement);
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [language]);

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    direction: language === 'ar' ? 'rtl' : 'ltr',
    setLanguage,
    toggleLanguage,
    t,
  }), [language, setLanguage, t, toggleLanguage]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
