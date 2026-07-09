export const STORAGE_KEY = "bibleSchoolManager.v2";

export const LEGACY_DEFAULT_TEAMS = [
  { id: "praise", name: "찬양팀" },
  { id: "operations", name: "운영팀" },
  { id: "prayer", name: "기도팀" },
];

export function createInitialState() {
  return {
    participants: [],
    groups: [
      { id: "group-1", name: "1조" },
      { id: "group-2", name: "2조" },
      { id: "group-3", name: "3조" },
      { id: "group-4", name: "4조" },
    ],
    teams: [],
    dayLabels: ["1일차", "2일차", "3일차"],
  };
}

export function normalizeState(raw = {}) {
  const fallback = createInitialState();
  const teams = migrateTeams(raw);
  return {
    participants: Array.isArray(raw.participants)
      ? raw.participants.map((person) => normalizeParticipant(person, teams))
      : Array.isArray(raw.applicants)
        ? raw.applicants.map((person) => normalizeParticipant(person, teams))
        : [],
    groups: Array.isArray(raw.groups) && raw.groups.length ? raw.groups : fallback.groups,
    teams,
    dayLabels: Array.isArray(raw.dayLabels) ? raw.dayLabels : fallback.dayLabels,
  };
}

export function normalizeParticipant(raw = {}, teams = []) {
  const role = normalizeRole(raw.role);
  const legacyPhone = String(raw.phone || raw["연락처"] || raw["전화번호"] || "").trim();
  const groupIds = role === "선생님" ? normalizeList(raw.groupIds || raw.groupId) : [];
  const groupId = role === "학생" ? String(raw.groupId || "").trim() : "";
  return {
    id: raw.id || crypto.randomUUID(),
    role,
    name: String(raw.name || "").trim(),
    gender: normalizeGender(raw.gender),
    age: normalizeAge(raw.age),
    guardian: String(raw.guardian || "").trim(),
    selfPhone: String(raw.selfPhone || raw.personalPhone || raw["본인연락처"] || raw["본인 연락처"] || (role === "선생님" ? legacyPhone : "")).trim(),
    guardianPhone: String(raw.guardianPhone || raw.parentPhone || raw["보호자연락처"] || raw["보호자 연락처"] || (role === "학생" ? legacyPhone : "")).trim(),
    friends: String(raw.friends || raw.friend || raw["교우관계"] || "").trim(),
    notes: String(raw.notes || raw["특이사항"] || "").trim(),
    isLeader: role === "학생" && normalizeBoolean(raw.isLeader || raw.leader || raw["조장"]),
    groupId,
    groupIds,
    teamIds: normalizeList(raw.teamIds || raw.teams || raw["팀"]).map((value) => teamIdFromName(value, teams)).filter((teamId) => teams.some((team) => team.id === teamId)),
    attendance: raw.attendance || { day1: false, day2: false, day3: false, memo: "" },
    medical: raw.medical || {
      allergies: "",
      medication: "",
      conditions: "",
      emergencyContact: "",
      incidentLog: "",
    },
  };
}

export function normalizeRole(value) {
  const text = String(value || "").trim().toLowerCase();
  if (["teacher", "선생", "선생님", "교사"].includes(text)) return "선생님";
  return "학생";
}

export function normalizeGender(value) {
  const text = String(value || "").trim().toLowerCase();
  if (["m", "male", "남", "남자"].includes(text)) return "남";
  if (["f", "female", "여", "여자"].includes(text)) return "여";
  return String(value || "").trim();
}

export function normalizeAge(value) {
  const text = String(value ?? "").trim();
  if (!text || Number(text) <= 0) return "";
  return Number(text);
}

export function normalizeList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || "").split(/[,，、]/).map((item) => item.trim()).filter(Boolean);
}

export function normalizeBoolean(value) {
  if (typeof value === "boolean") return value;
  const text = String(value || "").trim().toLowerCase();
  return ["true", "1", "yes", "y", "조장", "예", "네", "o", "선택"].includes(text);
}

export function migrateTeams(raw = {}) {
  const teams = Array.isArray(raw.teams) ? raw.teams.map((team) => ({ id: String(team.id || crypto.randomUUID()), name: String(team.name || "새 사역팀").trim() || "새 사역팀" })) : [];
  const knownIds = new Set(teams.map((team) => team.id));
  const referencedTeamIds = new Set();

  (raw.participants || raw.applicants || []).forEach((person) => {
    normalizeList(person.teamIds || person.teams || person["팀"]).forEach((teamId) => referencedTeamIds.add(teamId));
  });

  LEGACY_DEFAULT_TEAMS.forEach((team) => {
    if (referencedTeamIds.has(team.id) && !knownIds.has(team.id)) {
      teams.push({ ...team });
      knownIds.add(team.id);
    }
  });

  referencedTeamIds.forEach((teamId) => {
    if (!knownIds.has(teamId)) {
      teams.push({ id: teamId, name: teamId });
      knownIds.add(teamId);
    }
  });

  return teams;
}

export function teamIdFromName(value, teams) {
  return teams.find((team) => team.id === value || team.name === value)?.id || value;
}

export function isStudent(person) {
  return normalizeRole(person.role) === "학생";
}

export function isTeacher(person) {
  return normalizeRole(person.role) === "선생님";
}

export function missingRequiredFields(person) {
  const common = [
    ["이름", person.name],
    ["성별", person.gender],
  ];
  const roleSpecific = isTeacher(person) ? [] : [["나이", person.age], ["보호자연락처", person.guardianPhone]];
  return [...common, ...roleSpecific].filter(([, value]) => !String(value || "").trim()).map(([label]) => label);
}
