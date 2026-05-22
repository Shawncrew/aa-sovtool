export type Language = "en" | "de" | "nl" | "ru" | "zh";

export interface Translations {
  // Auth
  login: string;
  logout: string;
  username: string;
  password: string;
  signIn: string;
  invalidCredentials: string;
  signInFailed: string;
  
  // Roles
  admin: string;
  edit: string;
  view: string;
  export: string;
  import: string;
  transit: string;
  
  // User Management
  manageUsers: string;
  userManagement: string;
  createAndManageAccounts: string;
  addUser: string;
  deleteUser: string;
  updateUser: string;
  newUser: string;
  role: string;
  actions: string;
  close: string;
  
  // Scenario
  saveScenario: string;
  saving: string;
  scenarioSaved: string;
  downloadBackup: string;
  restoreBackup: string;
  backupRestored: string;
  
  // History
  showHistory: string;
  hideHistory: string;
  recentChanges: string;
  noChangesRecorded: string;
  clear: string;
  historyCleared: string;
  
  // System Color
  systemColor: string;
  systemColorGradient: string;
  systemColorTrueSec: string;
  systemColorWorkforce: string;
  systemColorPower: string;
  systemColorSuperionicIce: string;
  systemColorMagmaticGas: string;
  
  // System Card
  power: string;
  workforce: string;
  npc: string;
  inspector: string;
  
  // System Details
  selectSystem: string;
  selectSystemToInspect: string;
  systemDetails: string;
  constellation: string;
  region: string;
  security: string;
  starType: string;
  starPower: string;
  planetPower: string;
  basePower: string;
  baseWorkforce: string;
  totalPower: string;
  workforceCapacity: string;
  powerUsage: string;
  workforceUsage: string;
  systemRole: string;
  upgradePower: string;
  upgradeWorkforce: string;
  icePerHour: string;
  gasPerHour: string;
  transitOut: string;
  upgrades: string;
  transfers: string;
  noUpgrades: string;
  noUpgradesApplied: string;
  addUpgradesUsingSelector: string;
  noTransfers: string;
  addUpgrade: string;
  removeUpgrade: string;
  remove: string;
  enable: string;
  disable: string;
  addTransfer: string;
  removeTransfer: string;
  source: string;
  target: string;
  amount: string;
  via: string;
  direct: string;
  online: string;
  offline: string;
  workforceExports: string;
  exportsCanSupply: string;
  noExportRoutes: string;
  ansiblexLink: string;
  pairSystemForAnsiblex: string;
  noLink: string;
  noEligibleSystems: string;
  currentlyLinkedWith: string;
  linkedWith: string;
  noAnsiblexLinkConfigured: string;
  installAdvancedLogisticsForAnsiblex: string;
  
  // Messages
  loading: string;
  loadingSystems: string;
  failedToLoad: string;
  ensureApiRunning: string;
  noPermission: string;
  removedExtraExportRoutes: string;
  removedExtraExportRoute: string;
  
  // Language Selector
  selectLanguage: string;
  english: string;
  german: string;
  dutch: string;
  russian: string;
  mandarin: string;
}

export const translations: Record<Language, Translations> = {
  en: {
    login: "Login",
    logout: "Log Out",
    username: "Username",
    password: "Password",
    signIn: "Sign In",
    invalidCredentials: "Invalid username or password.",
    signInFailed: "Failed to sign in. Please try again.",
    admin: "Admin",
    edit: "Edit",
    view: "View",
    export: "Export",
    import: "Import",
    transit: "Transit",
    manageUsers: "Manage Users",
    userManagement: "User Management",
    createAndManageAccounts: "Create and manage accounts for the Sovereignty Planner.",
    addUser: "Add User",
    deleteUser: "Delete",
    updateUser: "Update",
    newUser: "New User",
    role: "Role",
    actions: "Actions",
    close: "Close",
    saveScenario: "Save Scenario",
    saving: "Saving…",
    scenarioSaved: "Scenario saved.",
    downloadBackup: "Download Backup",
    restoreBackup: "Restore Backup",
    backupRestored: "Backup restored.",
    showHistory: "Show History",
    hideHistory: "Hide History",
    recentChanges: "Recent Changes",
    noChangesRecorded: "No changes recorded yet.",
    clear: "Clear",
    historyCleared: "History cleared.",
    systemColor: "System Color",
    systemColorGradient: "Color Gradient",
    systemColorTrueSec: "True Sec",
    systemColorWorkforce: "Workforce",
    systemColorPower: "Power",
    systemColorSuperionicIce: "Superionic Ice",
    systemColorMagmaticGas: "Magmatic Gas",
    power: "Power",
    workforce: "Workforce",
    npc: "NPC",
    inspector: "Inspector",
    selectSystem: "Select a system",
    selectSystemToInspect: "Select a system to inspect resource totals and adjust its role.",
    systemDetails: "System Details",
    constellation: "Constellation",
    region: "Region",
    security: "Security",
    starType: "Star Type",
    starPower: "Star Power",
    planetPower: "Planet Power",
    basePower: "Base Power",
    baseWorkforce: "Base Workforce",
    totalPower: "Total Power",
    workforceCapacity: "Workforce Capacity",
    powerUsage: "Power Usage",
    workforceUsage: "Workforce Usage",
    systemRole: "System Role",
    upgradePower: "Upgrade Power",
    upgradeWorkforce: "Upgrade Workforce",
    icePerHour: "Ice / hr",
    gasPerHour: "Gas / hr",
    transitOut: "Transit Out",
    upgrades: "Upgrades",
    transfers: "Transfers",
    noUpgrades: "No upgrades",
    noUpgradesApplied: "No upgrades applied to this system.",
    addUpgradesUsingSelector: "Add upgrades using the selector above.",
    noTransfers: "No transfers",
    addUpgrade: "Add Upgrade",
    removeUpgrade: "Remove Upgrade",
    remove: "Remove",
    enable: "Enable",
    disable: "Disable",
    addTransfer: "Add Transfer",
    removeTransfer: "Remove Transfer",
    source: "Source",
    target: "Target",
    amount: "Amount",
    via: "Via",
    direct: "direct",
    online: "Online",
    offline: "Offline",
    workforceExports: "Workforce Exports",
    exportsCanSupply: "Exports can supply workforce to import systems directly or through a single transit system.",
    noExportRoutes: "No export routes configured yet.",
    ansiblexLink: "Ansiblex Link",
    pairSystemForAnsiblex: "Pair this system with another Advanced Logistics Network to form an Ansiblex connection.",
    noLink: "No Link",
    noEligibleSystems: "No eligible systems",
    currentlyLinkedWith: "Currently linked with",
    linkedWith: "Linked with",
    noAnsiblexLinkConfigured: "No Ansiblex link configured.",
    installAdvancedLogisticsForAnsiblex: "Install and online an Advanced Logistics Network upgrade to create an Ansiblex connection.",
    loading: "Loading",
    loadingSystems: "Loading systems…",
    failedToLoad: "Failed to load scenario. Ensure the API is running on localhost:8000.",
    ensureApiRunning: "Ensure the API is running on localhost:8000.",
    noPermission: "You do not have permission to modify this scenario.",
    removedExtraExportRoutes: "Removed {count} extra export route{s} to enforce the single-destination rule.",
    removedExtraExportRoute: "Removed {count} extra export route to enforce the single-destination rule.",
    selectLanguage: "Select Language",
    english: "English",
    german: "German",
    dutch: "Dutch",
    russian: "Russian",
    mandarin: "Mandarin",
  },
  de: {
    login: "Anmelden",
    logout: "Abmelden",
    username: "Benutzername",
    password: "Passwort",
    signIn: "Anmelden",
    invalidCredentials: "Ungültiger Benutzername oder Passwort.",
    signInFailed: "Anmeldung fehlgeschlagen. Bitte versuchen Sie es erneut.",
    admin: "Administrator",
    edit: "Bearbeiten",
    view: "Anzeigen",
    export: "Export",
    import: "Import",
    transit: "Transit",
    manageUsers: "Benutzer verwalten",
    userManagement: "Benutzerverwaltung",
    createAndManageAccounts: "Erstellen und verwalten Sie Konten für den Souveränitätsplaner.",
    addUser: "Benutzer hinzufügen",
    deleteUser: "Löschen",
    updateUser: "Aktualisieren",
    newUser: "Neuer Benutzer",
    role: "Rolle",
    actions: "Aktionen",
    close: "Schließen",
    saveScenario: "Szenario speichern",
    saving: "Speichern…",
    scenarioSaved: "Szenario gespeichert.",
    downloadBackup: "Backup herunterladen",
    restoreBackup: "Backup wiederherstellen",
    backupRestored: "Backup wiederhergestellt.",
    showHistory: "Verlauf anzeigen",
    hideHistory: "Verlauf ausblenden",
    recentChanges: "Letzte Änderungen",
    noChangesRecorded: "Noch keine Änderungen aufgezeichnet.",
    clear: "Löschen",
    historyCleared: "Verlauf gelöscht.",
    systemColor: "Systemfarbe",
    systemColorGradient: "Farbverlauf",
    systemColorTrueSec: "Echte Sicherheit",
    systemColorWorkforce: "Arbeitskraft",
    systemColorPower: "Energie",
    systemColorSuperionicIce: "Superionisches Eis",
    systemColorMagmaticGas: "Magmatisches Gas",
    power: "Energie",
    workforce: "Arbeitskraft",
    npc: "NPC",
    inspector: "Inspektor",
    selectSystem: "System auswählen",
    selectSystemToInspect: "Wählen Sie ein System aus, um Ressourcengesamtsummen zu überprüfen und seine Rolle anzupassen.",
    systemDetails: "Systemdetails",
    constellation: "Sternbild",
    region: "Region",
    security: "Sicherheit",
    starType: "Sterntyp",
    starPower: "Sternenergie",
    planetPower: "Planetenenergie",
    basePower: "Basisenergie",
    baseWorkforce: "Basisarbeitskraft",
    totalPower: "Gesamtenergie",
    workforceCapacity: "Arbeitskraftkapazität",
    powerUsage: "Energieverbrauch",
    workforceUsage: "Arbeitskraftverbrauch",
    systemRole: "Systemrolle",
    upgradePower: "Upgrade-Energie",
    upgradeWorkforce: "Upgrade-Arbeitskraft",
    icePerHour: "Eis / Std",
    gasPerHour: "Gas / Std",
    transitOut: "Transit Aus",
    upgrades: "Upgrades",
    transfers: "Transfers",
    noUpgrades: "Keine Upgrades",
    noUpgradesApplied: "Keine Upgrades auf dieses System angewendet.",
    addUpgradesUsingSelector: "Fügen Sie Upgrades mit dem Auswahlfeld oben hinzu.",
    noTransfers: "Keine Transfers",
    addUpgrade: "Upgrade hinzufügen",
    removeUpgrade: "Upgrade entfernen",
    remove: "Entfernen",
    enable: "Aktivieren",
    disable: "Deaktivieren",
    addTransfer: "Transfer hinzufügen",
    removeTransfer: "Transfer entfernen",
    source: "Quelle",
    target: "Ziel",
    amount: "Menge",
    via: "Über",
    direct: "direkt",
    online: "Online",
    offline: "Offline",
    workforceExports: "Arbeitskraftexporte",
    exportsCanSupply: "Exporte können Arbeitskraft direkt oder über ein einzelnes Transitsystem an Import-Systeme liefern.",
    noExportRoutes: "Noch keine Exportrouten konfiguriert.",
    ansiblexLink: "Ansiblex-Verbindung",
    pairSystemForAnsiblex: "Koppeln Sie dieses System mit einem anderen Advanced Logistics Network, um eine Ansiblex-Verbindung zu bilden.",
    noLink: "Keine Verbindung",
    noEligibleSystems: "Keine geeigneten Systeme",
    currentlyLinkedWith: "Derzeit verbunden mit",
    linkedWith: "Verbunden mit",
    noAnsiblexLinkConfigured: "Keine Ansiblex-Verbindung konfiguriert.",
    installAdvancedLogisticsForAnsiblex: "Installieren und aktivieren Sie ein Advanced Logistics Network Upgrade, um eine Ansiblex-Verbindung zu erstellen.",
    loading: "Laden",
    loadingSystems: "Systeme werden geladen…",
    failedToLoad: "Szenario konnte nicht geladen werden. Stellen Sie sicher, dass die API auf localhost:8000 läuft.",
    ensureApiRunning: "Stellen Sie sicher, dass die API auf localhost:8000 läuft.",
    noPermission: "Sie haben keine Berechtigung, dieses Szenario zu ändern.",
    removedExtraExportRoutes: "{count} zusätzliche Exportroute{n} entfernt, um die Einzelzielregel durchzusetzen.",
    removedExtraExportRoute: "{count} zusätzliche Exportroute entfernt, um die Einzelzielregel durchzusetzen.",
    selectLanguage: "Sprache auswählen",
    english: "Englisch",
    german: "Deutsch",
    dutch: "Niederländisch",
    russian: "Russisch",
    mandarin: "Mandarin",
  },
  nl: {
    login: "Inloggen",
    logout: "Uitloggen",
    username: "Gebruikersnaam",
    password: "Wachtwoord",
    signIn: "Inloggen",
    invalidCredentials: "Ongeldige gebruikersnaam of wachtwoord.",
    signInFailed: "Inloggen mislukt. Probeer het opnieuw.",
    admin: "Beheerder",
    edit: "Bewerken",
    view: "Bekijken",
    export: "Exporteren",
    import: "Importeren",
    transit: "Transit",
    manageUsers: "Gebruikers beheren",
    userManagement: "Gebruikersbeheer",
    createAndManageAccounts: "Maak en beheer accounts voor de Soevereiniteitsplanner.",
    addUser: "Gebruiker toevoegen",
    deleteUser: "Verwijderen",
    updateUser: "Bijwerken",
    newUser: "Nieuwe gebruiker",
    role: "Rol",
    actions: "Acties",
    close: "Sluiten",
    saveScenario: "Scenario opslaan",
    saving: "Opslaan…",
    scenarioSaved: "Scenario opgeslagen.",
    downloadBackup: "Backup downloaden",
    restoreBackup: "Backup herstellen",
    backupRestored: "Backup hersteld.",
    showHistory: "Geschiedenis tonen",
    hideHistory: "Geschiedenis verbergen",
    recentChanges: "Recente wijzigingen",
    noChangesRecorded: "Nog geen wijzigingen geregistreerd.",
    clear: "Wissen",
    historyCleared: "Geschiedenis gewist.",
    systemColor: "Systeemkleur",
    systemColorGradient: "Kleurverloop",
    systemColorTrueSec: "Echte Beveiliging",
    systemColorWorkforce: "Werkkracht",
    systemColorPower: "Energie",
    systemColorSuperionicIce: "Superionisch IJs",
    systemColorMagmaticGas: "Magmatisch Gas",
    power: "Energie",
    workforce: "Werkkracht",
    npc: "NPC",
    inspector: "Inspecteur",
    selectSystem: "Selecteer een systeem",
    selectSystemToInspect: "Selecteer een systeem om resourcetotalen te inspecteren en de rol aan te passen.",
    systemDetails: "Systeemdetails",
    constellation: "Sterrenbeeld",
    region: "Regio",
    security: "Beveiliging",
    starType: "Stertype",
    starPower: "Sterenergie",
    planetPower: "Planeetenergie",
    basePower: "Basisenergie",
    baseWorkforce: "Basiswerkkracht",
    totalPower: "Totale energie",
    workforceCapacity: "Werkkrachtcapaciteit",
    powerUsage: "Energiegebruik",
    workforceUsage: "Werkkrachtgebruik",
    systemRole: "Systeemrol",
    upgradePower: "Upgrade-energie",
    upgradeWorkforce: "Upgrade-werkkracht",
    icePerHour: "IJs / uur",
    gasPerHour: "Gas / uur",
    transitOut: "Transit Uit",
    upgrades: "Upgrades",
    transfers: "Transfers",
    noUpgrades: "Geen upgrades",
    noUpgradesApplied: "Geen upgrades toegepast op dit systeem.",
    addUpgradesUsingSelector: "Voeg upgrades toe met behulp van de selector hierboven.",
    noTransfers: "Geen transfers",
    addUpgrade: "Upgrade toevoegen",
    removeUpgrade: "Upgrade verwijderen",
    remove: "Verwijderen",
    enable: "Inschakelen",
    disable: "Uitschakelen",
    addTransfer: "Transfer toevoegen",
    removeTransfer: "Transfer verwijderen",
    source: "Bron",
    target: "Doel",
    amount: "Hoeveelheid",
    via: "Via",
    direct: "direct",
    online: "Online",
    offline: "Offline",
    workforceExports: "Werkkrachtexporten",
    exportsCanSupply: "Exporten kunnen werkkracht direct of via een enkel transitsysteem aan importsystemen leveren.",
    noExportRoutes: "Nog geen exportroutes geconfigureerd.",
    ansiblexLink: "Ansiblex-verbinding",
    pairSystemForAnsiblex: "Koppel dit systeem met een ander Advanced Logistics Network om een Ansiblex-verbinding te vormen.",
    noLink: "Geen verbinding",
    noEligibleSystems: "Geen geschikte systemen",
    currentlyLinkedWith: "Momenteel verbonden met",
    linkedWith: "Verbonden met",
    noAnsiblexLinkConfigured: "Geen Ansiblex-verbinding geconfigureerd.",
    installAdvancedLogisticsForAnsiblex: "Installeer en activeer een Advanced Logistics Network upgrade om een Ansiblex-verbinding te maken.",
    loading: "Laden",
    loadingSystems: "Systemen laden…",
    failedToLoad: "Scenario laden mislukt. Zorg ervoor dat de API op localhost:8000 draait.",
    ensureApiRunning: "Zorg ervoor dat de API op localhost:8000 draait.",
    noPermission: "U heeft geen toestemming om dit scenario te wijzigen.",
    removedExtraExportRoutes: "{count} extra exportroute{s} verwijderd om de enkele-bestemmingregel af te dwingen.",
    removedExtraExportRoute: "{count} extra exportroute verwijderd om de enkele-bestemmingregel af te dwingen.",
    selectLanguage: "Taal selecteren",
    english: "Engels",
    german: "Duits",
    dutch: "Nederlands",
    russian: "Russisch",
    mandarin: "Mandarijn",
  },
  ru: {
    login: "Войти",
    logout: "Выйти",
    username: "Имя пользователя",
    password: "Пароль",
    signIn: "Войти",
    invalidCredentials: "Неверное имя пользователя или пароль.",
    signInFailed: "Не удалось войти. Пожалуйста, попробуйте снова.",
    admin: "Администратор",
    edit: "Редактировать",
    view: "Просмотр",
    export: "Экспорт",
    import: "Импорт",
    transit: "Транзит",
    manageUsers: "Управление пользователями",
    userManagement: "Управление пользователями",
    createAndManageAccounts: "Создавайте и управляйте учетными записями для планировщика суверенитета.",
    addUser: "Добавить пользователя",
    deleteUser: "Удалить",
    updateUser: "Обновить",
    newUser: "Новый пользователь",
    role: "Роль",
    actions: "Действия",
    close: "Закрыть",
    saveScenario: "Сохранить сценарий",
    saving: "Сохранение…",
    scenarioSaved: "Сценарий сохранен.",
    downloadBackup: "Скачать резервную копию",
    restoreBackup: "Восстановить резервную копию",
    backupRestored: "Резервная копия восстановлена.",
    showHistory: "Показать историю",
    hideHistory: "Скрыть историю",
    recentChanges: "Последние изменения",
    noChangesRecorded: "Изменения еще не зарегистрированы.",
    clear: "Очистить",
    historyCleared: "История очищена.",
    systemColor: "Цвет системы",
    systemColorGradient: "Цветовой градиент",
    systemColorTrueSec: "Истинная безопасность",
    systemColorWorkforce: "Рабочая сила",
    systemColorPower: "Энергия",
    systemColorSuperionicIce: "Суперионный лед",
    systemColorMagmaticGas: "Магматический газ",
    power: "Энергия",
    workforce: "Рабочая сила",
    npc: "NPC",
    inspector: "Инспектор",
    selectSystem: "Выберите систему",
    selectSystemToInspect: "Выберите систему для проверки общих ресурсов и изменения ее роли.",
    systemDetails: "Детали системы",
    constellation: "Созвездие",
    region: "Регион",
    security: "Безопасность",
    starType: "Тип звезды",
    starPower: "Энергия звезды",
    planetPower: "Энергия планеты",
    basePower: "Базовая энергия",
    baseWorkforce: "Базовая рабочая сила",
    totalPower: "Общая энергия",
    workforceCapacity: "Емкость рабочей силы",
    powerUsage: "Использование энергии",
    workforceUsage: "Использование рабочей силы",
    systemRole: "Роль системы",
    upgradePower: "Энергия улучшений",
    upgradeWorkforce: "Рабочая сила улучшений",
    icePerHour: "Лед / час",
    gasPerHour: "Газ / час",
    transitOut: "Транзит Выход",
    upgrades: "Улучшения",
    transfers: "Переводы",
    noUpgrades: "Нет улучшений",
    noUpgradesApplied: "На эту систему не применены улучшения.",
    addUpgradesUsingSelector: "Добавьте улучшения, используя селектор выше.",
    noTransfers: "Нет переводов",
    addUpgrade: "Добавить улучшение",
    removeUpgrade: "Удалить улучшение",
    remove: "Удалить",
    enable: "Включить",
    disable: "Отключить",
    addTransfer: "Добавить перевод",
    removeTransfer: "Удалить перевод",
    source: "Источник",
    target: "Цель",
    amount: "Количество",
    via: "Через",
    direct: "напрямую",
    online: "Онлайн",
    offline: "Офлайн",
    workforceExports: "Экспорт рабочей силы",
    exportsCanSupply: "Экспорты могут поставлять рабочую силу системам импорта напрямую или через одну транзитную систему.",
    noExportRoutes: "Маршруты экспорта еще не настроены.",
    ansiblexLink: "Связь Ansiblex",
    pairSystemForAnsiblex: "Свяжите эту систему с другой Advanced Logistics Network, чтобы сформировать соединение Ansiblex.",
    noLink: "Нет связи",
    noEligibleSystems: "Нет подходящих систем",
    currentlyLinkedWith: "В настоящее время связан с",
    linkedWith: "Связан с",
    noAnsiblexLinkConfigured: "Связь Ansiblex не настроена.",
    installAdvancedLogisticsForAnsiblex: "Установите и активируйте улучшение Advanced Logistics Network, чтобы создать соединение Ansiblex.",
    loading: "Загрузка",
    loadingSystems: "Загрузка систем…",
    failedToLoad: "Не удалось загрузить сценарий. Убедитесь, что API работает на localhost:8000.",
    ensureApiRunning: "Убедитесь, что API работает на localhost:8000.",
    noPermission: "У вас нет разрешения на изменение этого сценария.",
    removedExtraExportRoutes: "Удалено {count} дополнительных экспортных маршрута{ов} для соблюдения правила одного назначения.",
    removedExtraExportRoute: "Удален {count} дополнительный экспортный маршрут для соблюдения правила одного назначения.",
    selectLanguage: "Выбрать язык",
    english: "Английский",
    german: "Немецкий",
    dutch: "Голландский",
    russian: "Русский",
    mandarin: "Китайский",
  },
  zh: {
    login: "登录",
    logout: "退出",
    username: "用户名",
    password: "密码",
    signIn: "登录",
    invalidCredentials: "用户名或密码无效。",
    signInFailed: "登录失败。请重试。",
    admin: "管理员",
    edit: "编辑",
    view: "查看",
    export: "导出",
    import: "导入",
    transit: "过境",
    manageUsers: "管理用户",
    userManagement: "用户管理",
    createAndManageAccounts: "为主权规划器创建和管理账户。",
    addUser: "添加用户",
    deleteUser: "删除",
    updateUser: "更新",
    newUser: "新用户",
    role: "角色",
    actions: "操作",
    close: "关闭",
    saveScenario: "保存场景",
    saving: "保存中…",
    scenarioSaved: "场景已保存。",
    downloadBackup: "下载备份",
    restoreBackup: "恢复备份",
    backupRestored: "备份已恢复。",
    showHistory: "显示历史",
    hideHistory: "隐藏历史",
    recentChanges: "最近更改",
    noChangesRecorded: "尚未记录任何更改。",
    clear: "清除",
    historyCleared: "历史已清除。",
    systemColor: "系统颜色",
    systemColorGradient: "颜色渐变",
    systemColorTrueSec: "真实安全",
    systemColorWorkforce: "劳动力",
    systemColorPower: "能量",
    systemColorSuperionicIce: "超离子冰",
    systemColorMagmaticGas: "岩浆气体",
    power: "能量",
    workforce: "劳动力",
    npc: "NPC",
    inspector: "检查器",
    selectSystem: "选择系统",
    selectSystemToInspect: "选择一个系统以检查资源总量并调整其角色。",
    systemDetails: "系统详情",
    constellation: "星座",
    region: "区域",
    security: "安全",
    starType: "恒星类型",
    starPower: "恒星能量",
    planetPower: "行星能量",
    basePower: "基础能量",
    baseWorkforce: "基础劳动力",
    totalPower: "总能量",
    workforceCapacity: "劳动力容量",
    powerUsage: "能量使用",
    workforceUsage: "劳动力使用",
    systemRole: "系统角色",
    upgradePower: "升级能量",
    upgradeWorkforce: "升级劳动力",
    icePerHour: "冰 / 小时",
    gasPerHour: "气体 / 小时",
    transitOut: "过境输出",
    upgrades: "升级",
    transfers: "转移",
    noUpgrades: "无升级",
    noUpgradesApplied: "此系统未应用任何升级。",
    addUpgradesUsingSelector: "使用上方的选择器添加升级。",
    noTransfers: "无转移",
    addUpgrade: "添加升级",
    removeUpgrade: "移除升级",
    remove: "移除",
    enable: "启用",
    disable: "禁用",
    addTransfer: "添加转移",
    removeTransfer: "移除转移",
    source: "来源",
    target: "目标",
    amount: "数量",
    via: "通过",
    direct: "直接",
    online: "在线",
    offline: "离线",
    workforceExports: "劳动力出口",
    exportsCanSupply: "出口可以直接或通过单个过境系统向进口系统提供劳动力。",
    noExportRoutes: "尚未配置出口路线。",
    ansiblexLink: "Ansiblex链接",
    pairSystemForAnsiblex: "将此系统与另一个高级物流网络配对以形成Ansiblex连接。",
    noLink: "无链接",
    noEligibleSystems: "无符合条件的系统",
    currentlyLinkedWith: "当前链接到",
    linkedWith: "链接到",
    noAnsiblexLinkConfigured: "未配置Ansiblex链接。",
    installAdvancedLogisticsForAnsiblex: "安装并启用高级物流网络升级以创建Ansiblex连接。",
    loading: "加载中",
    loadingSystems: "加载系统中…",
    failedToLoad: "加载场景失败。请确保API在localhost:8000上运行。",
    ensureApiRunning: "请确保API在localhost:8000上运行。",
    noPermission: "您没有权限修改此场景。",
    removedExtraExportRoutes: "已删除{count}条额外导出路线{复数}以强制执行单一目标规则。",
    removedExtraExportRoute: "已删除{count}条额外导出路线以强制执行单一目标规则。",
    selectLanguage: "选择语言",
    english: "英语",
    german: "德语",
    dutch: "荷兰语",
    russian: "俄语",
    mandarin: "中文",
  },
};

