import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import readXlsxFile from "read-excel-file/browser";
import "../styles.css";
import {
  createInitialState,
  isStudent,
  isTeacher,
  missingRequiredFields,
  normalizeGender,
  normalizeParticipant,
  normalizeRole,
} from "./lib/model";
import {
  getSessionProfile,
  isSupabaseEnabled,
  loadAppState,
  saveAppState,
  signIn,
  signOut,
} from "./lib/storage";

const emptyParticipant = {
  role: "학생",
  name: "",
  gender: "",
  age: "",
  guardian: "",
  selfPhone: "",
  guardianPhone: "",
  friends: "",
  notes: "",
};

function App() {
  const [state, setState] = useState(createInitialState());
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState("register");
  const [form, setForm] = useState(emptyParticipant);
  const [editingId, setEditingId] = useState("");
  const [search, setSearch] = useState("");
  const [orgSearch, setOrgSearch] = useState("");
  const [medicalSearch, setMedicalSearch] = useState("");
  const [teamName, setTeamName] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [selectedParticipantIds, setSelectedParticipantIds] = useState([]);
  const [authForm, setAuthForm] = useState({ email: "", password: "" });
  const [authError, setAuthError] = useState("");

  const canAdmin = profile?.role === "관리자";
  const canMedical = profile?.role === "관리자" || profile?.role === "의료인";
  const canAttendance = profile?.role === "관리자" || profile?.role === "선생님";

  useEffect(() => {
    async function boot() {
      try {
        const currentProfile = await getSessionProfile();
        setProfile(currentProfile);
        setState(await loadAppState());
      } finally {
        setLoading(false);
      }
    }
    boot();
  }, []);

  async function persist(nextState) {
    const savedState = await saveAppState(nextState);
    setState(savedState);
  }

  async function handleLogin(event) {
    event.preventDefault();
    setAuthError("");
    try {
      const nextProfile = await signIn(authForm.email, authForm.password);
      setProfile(nextProfile);
      setState(await loadAppState());
    } catch (error) {
      setAuthError(error.message || "로그인할 수 없습니다.");
    }
  }

  async function handleLogout() {
    await signOut();
    setProfile(null);
  }

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function addParticipant(event) {
    event.preventDefault();
    if (!canAdmin) return;
    const participant = normalizeParticipant(form, state.teams);
    const missing = missingRequiredFields(participant);
    if (missing.length) {
      alert(`${participant.role} 필수 항목을 입력해주세요: ${missing.join(", ")}`);
      return;
    }
    if (hasDuplicateParticipantName(state.participants, participant.name)) {
      alert(`이미 등록된 이름입니다: ${participant.name}`);
      return;
    }
    await persist({ ...state, participants: [...state.participants, participant] });
    setForm(emptyParticipant);
  }

  async function updateParticipant(participant) {
    if (!canAdmin) return;
    const previous = state.participants.find((person) => person.id === participant.id);
    const normalized = normalizeParticipant(participant, state.teams);
    normalized.groupId = isStudent(normalized) ? previous?.groupId || "" : "";
    normalized.groupIds = isTeacher(normalized) ? previous?.groupIds || [] : [];
    normalized.teamIds = isTeacher(normalized) ? previous?.teamIds || [] : [];
    normalized.attendance = previous?.attendance || normalized.attendance;
    normalized.medical = previous?.medical || normalized.medical;
    const missing = missingRequiredFields(normalized);
    if (missing.length) {
      alert(`${normalized.role} 필수 항목을 입력해주세요: ${missing.join(", ")}`);
      return;
    }
    if (hasDuplicateParticipantName(state.participants, normalized.name, normalized.id)) {
      alert(`이미 등록된 이름입니다: ${normalized.name}`);
      return;
    }
    await persist({
      ...state,
      participants: state.participants.map((person) => (person.id === normalized.id ? normalized : person)),
    });
    setEditingId("");
  }

  async function deleteParticipant(id) {
    if (!canAdmin) return;
    const person = state.participants.find((item) => item.id === id);
    if (!person || !confirm(`${person.name} 참석자를 삭제할까요?`)) return;
    await persist({ ...state, participants: state.participants.filter((item) => item.id !== id) });
    setSelectedParticipantIds((ids) => ids.filter((selectedId) => selectedId !== id));
    setEditingId("");
  }

  async function deleteSelectedParticipants(ids) {
    if (!canAdmin || !ids.length) return;
    const selectedNames = state.participants.filter((person) => ids.includes(person.id)).map((person) => person.name);
    if (!selectedNames.length || !confirm(`선택한 참석자 ${selectedNames.length}명을 삭제할까요?`)) return;
    await persist({ ...state, participants: state.participants.filter((person) => !ids.includes(person.id)) });
    setSelectedParticipantIds([]);
    setEditingId("");
  }

  async function applyGroupCount(count) {
    if (!canAdmin) return;
    const nextCount = Math.min(Math.max(Number(count || 1), 1), 20);
    const groups = [...state.groups];
    if (nextCount > groups.length) {
      for (let i = groups.length + 1; i <= nextCount; i += 1) {
        groups.push({ id: `group-${crypto.randomUUID()}`, name: `${i}조` });
      }
    } else if (nextCount < groups.length) {
      const removed = groups.splice(nextCount).map((group) => group.id);
      state.participants.forEach((person) => {
        if (removed.includes(person.groupId)) person.groupId = "";
        person.groupIds = (person.groupIds || []).filter((groupId) => !removed.includes(groupId));
      });
    }
    groups.forEach((group, index) => {
      group.name = `${index + 1}조`;
    });
    await persist({ ...state, groups, participants: [...state.participants] });
  }

  async function autoBalanceGroups() {
    if (!canAdmin) return;
    const buckets = state.groups.map((group) => ({ id: group.id, members: [] }));
    const participants = state.participants.map((person) => ({ ...person }));
    participants.filter(isStudent).sort((a, b) => Number(b.age || 0) - Number(a.age || 0)).forEach((student) => {
      buckets.sort((a, b) => scoreBucket(a.members, student) - scoreBucket(b.members, student));
      buckets[0].members.push(student);
      student.groupId = buckets[0].id;
    });
    await persist({ ...state, participants });
  }

  function scoreBucket(members, student) {
    const sameGender = members.filter((member) => member.gender === student.gender).length;
    const averageAge = members.length ? members.reduce((sum, member) => sum + Number(member.age || 0), 0) / members.length : Number(student.age || 0);
    const friends = parseList(student.friends);
    const hasFriend = members.some((member) => friends.includes(member.name));
    return members.length * 8 + sameGender * 2 + Math.abs(averageAge - Number(student.age || 0)) - (hasFriend ? 4 : 0);
  }

  async function assignToGroup(personId, groupId) {
    if (!canAdmin) return;
    const participants = state.participants.map((person) => {
      if (person.id !== personId) return person;
      if (isTeacher(person)) {
        const groupIds = groupId ? Array.from(new Set([...(person.groupIds || []), groupId])) : [];
        return { ...person, groupIds };
      }
      return { ...person, groupId };
    });
    await persist({ ...state, participants });
  }

  async function removeTeacherFromGroup(personId, groupId) {
    if (!canAdmin) return;
    await persist({
      ...state,
      participants: state.participants.map((person) => (
        person.id === personId ? { ...person, groupIds: (person.groupIds || []).filter((id) => id !== groupId) } : person
      )),
    });
  }

  async function addTeam(event) {
    event.preventDefault();
    if (!canAdmin) return;
    const name = teamName.trim();
    if (!name) return;
    if (state.teams.some((team) => team.name === name)) {
      alert("이미 있는 사역팀 이름입니다.");
      return;
    }
    await persist({ ...state, teams: [...state.teams, { id: `team-${crypto.randomUUID()}`, name }] });
    setTeamName("");
  }

  async function deleteTeam(teamId) {
    if (!canAdmin) return;
    const team = state.teams.find((item) => item.id === teamId);
    if (!team || !confirm(`${team.name} 사역팀을 삭제할까요?`)) return;
    await persist({
      ...state,
      teams: state.teams.filter((item) => item.id !== teamId),
      participants: state.participants.map((person) => ({ ...person, teamIds: (person.teamIds || []).filter((id) => id !== teamId) })),
    });
  }

  async function assignTeacherToTeam(personId, teamId) {
    if (!canAdmin || !personId) return;
    await persist({
      ...state,
      participants: state.participants.map((person) => (
        person.id === personId ? { ...person, teamIds: Array.from(new Set([...(person.teamIds || []), teamId])) } : person
      )),
    });
  }

  async function removeTeacherFromTeam(personId, teamId) {
    if (!canAdmin) return;
    await persist({
      ...state,
      participants: state.participants.map((person) => (
        person.id === personId ? { ...person, teamIds: (person.teamIds || []).filter((id) => id !== teamId) } : person
      )),
    });
  }

  async function updateAttendance(personId, key, value) {
    if (!canAttendance) return;
    await persist({
      ...state,
      participants: state.participants.map((person) => (
        person.id === personId ? { ...person, attendance: { ...person.attendance, [key]: value } } : person
      )),
    });
  }

  async function updateMedical(personId, key, value) {
    if (!canMedical) return;
    await persist({
      ...state,
      participants: state.participants.map((person) => (
        person.id === personId ? { ...person, medical: { ...person.medical, [key]: value } } : person
      )),
    });
  }

  async function importFile(file) {
    if (!file || !canAdmin) return;
    let rows;
    if (file.name.toLowerCase().endsWith(".csv")) {
      rows = parseCsv(await file.text());
    } else {
      rows = excelRowsToObjects(await readXlsxFile(file));
    }
    const parsed = rows.map((row) => normalizeParticipant(rowToParticipant(row), state.teams)).filter((person) => person.name);
    const existingNames = new Set(state.participants.map((person) => normalizeNameKey(person.name)).filter(Boolean));
    let duplicateCount = 0;
    const participants = parsed.filter((person) => {
      if (missingRequiredFields(person).length !== 0) return false;
      const nameKey = normalizeNameKey(person.name);
      if (existingNames.has(nameKey)) {
        duplicateCount += 1;
        return false;
      }
      existingNames.add(nameKey);
      return true;
    });
    await persist({ ...state, participants: [...state.participants, ...participants] });
    const missingCount = parsed.length - participants.length - duplicateCount;
    setImportStatus(`${participants.length}명을 가져왔습니다.${duplicateCount ? ` 중복 이름 ${duplicateCount}명은 건너뛰었습니다.` : ""}${missingCount ? ` 필수 항목 누락으로 ${missingCount}명은 건너뛰었습니다.` : ""}`);
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "성경학교_관리_백업.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importJson(file) {
    if (!file || !canAdmin) return;
    const next = JSON.parse(await file.text());
    await persist(next);
  }

  function downloadTemplate() {
    const csv = "\uFEFF역할,이름,성별,나이,보호자,본인연락처,보호자연락처,교우관계,특이사항\n학생,김하늘,남,10,김보호,,010-0000-0000,\"박은혜, 이사랑\",알레르기 확인\n선생님,이교사,여,,,010-1111-2222,,응급 연락 가능\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "성경학교_참석자_양식.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  const summary = useMemo(() => ({
    total: state.participants.length,
    students: state.participants.filter(isStudent).length,
    teachers: state.participants.filter(isTeacher).length,
    unassigned: state.participants.filter((person) => isStudent(person) && !person.groupId).length,
    medical: state.participants.filter((person) => Object.values(person.medical || {}).some(Boolean)).length,
  }), [state.participants]);

  if (loading) return <div className="loading-screen">불러오는 중입니다.</div>;

  if (isSupabaseEnabled() && !profile) {
    return (
      <main className="auth-shell">
        <form className="panel auth-form" onSubmit={handleLogin}>
          <h1>성경학교 참석자 관리</h1>
          <label>이메일<input value={authForm.email} onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })} /></label>
          <label>비밀번호<input type="password" value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} /></label>
          {authError && <p className="error-text">{authError}</p>}
          <button className="primary-btn" type="submit">로그인</button>
        </form>
      </main>
    );
  }

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Vacation Bible School</p>
          <h1>성경학교 참석자 관리</h1>
          <p className="mode-line">{isSupabaseEnabled() ? `Supabase 연결됨 · ${profile?.role || ""}` : "로컬 개발 모드"}</p>
        </div>
        <div className="top-actions">
          <button className="ghost-btn" type="button" onClick={exportJson}>백업 내보내기</button>
          {canAdmin && <label className="ghost-btn file-label">백업 불러오기<input type="file" accept="application/json" onChange={(event) => importJson(event.target.files?.[0])} /></label>}
          {isSupabaseEnabled() && <button className="ghost-btn" type="button" onClick={handleLogout}>로그아웃</button>}
        </div>
      </header>
      <main>
        <section className="summary-grid">
          <article><span>참석자</span><strong>{summary.total}</strong></article>
          <article><span>학생 / 선생님</span><strong>{summary.students} / {summary.teachers}</strong></article>
          <article><span>미배정 학생</span><strong>{summary.unassigned}</strong></article>
          <article><span>의무기록</span><strong>{summary.medical}</strong></article>
        </section>
        <nav className="tabs">
          {[
            ["register", "참석자 등록"],
            ["applicants", "참석자 조회"],
            ["groups", "조 Builder"],
            ["organization", "조직도"],
            ["attendance", "출석부"],
            ["medical", "의무기록"],
          ].map(([id, label]) => <button key={id} className={`tab ${activeView === id ? "is-active" : ""}`} onClick={() => setActiveView(id)} type="button">{label}</button>)}
        </nav>

        {activeView === "register" && (
          <RegisterView
            canAdmin={canAdmin}
            form={form}
            setField={updateForm}
            onSubmit={addParticipant}
            onTemplate={downloadTemplate}
            onImport={importFile}
            importStatus={importStatus}
          />
        )}
        {activeView === "applicants" && (
          <ApplicantsView
            canAdmin={canAdmin}
            state={state}
            search={search}
            setSearch={setSearch}
            editingId={editingId}
            setEditingId={setEditingId}
            onUpdate={updateParticipant}
            onDelete={deleteParticipant}
            selectedIds={selectedParticipantIds}
            setSelectedIds={setSelectedParticipantIds}
            onDeleteSelected={deleteSelectedParticipants}
          />
        )}
        {activeView === "groups" && (
          <GroupsView
            canAdmin={canAdmin}
            state={state}
            onGroupCount={applyGroupCount}
            onAutoBalance={autoBalanceGroups}
            onAssign={assignToGroup}
            onRemoveTeacher={removeTeacherFromGroup}
          />
        )}
        {activeView === "organization" && (
          <OrganizationView
            canAdmin={canAdmin}
            state={state}
            search={orgSearch}
            setSearch={setOrgSearch}
            teamName={teamName}
            setTeamName={setTeamName}
            onAddTeam={addTeam}
            onDeleteTeam={deleteTeam}
            onAssignTeacher={assignTeacherToTeam}
            onRemoveTeacher={removeTeacherFromTeam}
          />
        )}
        {activeView === "attendance" && (
          <AttendanceView
            canAttendance={canAttendance}
            state={state}
            setDayLabels={(dayLabels) => persist({ ...state, dayLabels })}
            onChange={updateAttendance}
          />
        )}
        {activeView === "medical" && (
          <MedicalView
            canMedical={canMedical}
            state={state}
            search={medicalSearch}
            setSearch={setMedicalSearch}
            onChange={updateMedical}
          />
        )}
      </main>
    </>
  );
}

function RegisterView({ canAdmin, form, setField, onSubmit, onTemplate, onImport, importStatus }) {
  return (
    <section className="view is-active">
      <div className="section-heading">
        <div><h2>참석자 등록</h2><p>학생과 선생님을 등록합니다. 사역팀 배정은 조직도에서 합니다.</p></div>
        <button className="secondary-btn" type="button" onClick={onTemplate}>양식 다운로드</button>
      </div>
      <div className="two-column">
        <form className="panel" onSubmit={onSubmit}>
          <h3>개별 등록</h3>
          <ParticipantFields participant={form} setField={setField} disabled={!canAdmin} />
          <button className="primary-btn" type="submit" disabled={!canAdmin}>참석자 추가</button>
        </form>
        <div className="panel import-panel">
          <h3>파일 가져오기</h3>
          <label className="drop-zone">
            <input type="file" accept=".csv,.xlsx,.xls" disabled={!canAdmin} onChange={(event) => onImport(event.target.files?.[0])} />
            <span>엑셀 또는 CSV 파일 선택</span>
            <small>권장 열: 역할, 이름, 성별, 나이, 보호자, 본인연락처, 보호자연락처, 교우관계, 특이사항</small>
          </label>
          <div className="status">{importStatus}</div>
        </div>
      </div>
    </section>
  );
}

function ParticipantFields({ participant, setField, disabled }) {
  const role = normalizeRole(participant.role);
  return (
    <div className="form-grid">
      <label>역할<select value={role} disabled={disabled} onChange={(event) => setField("role", event.target.value)}><option value="학생">학생</option><option value="선생님">선생님</option></select></label>
      <label className="is-required">이름<input value={participant.name} disabled={disabled} onChange={(event) => setField("name", event.target.value)} required /></label>
      <label className="is-required">성별<select value={participant.gender} disabled={disabled} onChange={(event) => setField("gender", event.target.value)} required><option value="">선택</option><option value="남">남</option><option value="여">여</option></select></label>
      <label className={role === "학생" ? "is-required" : ""}>나이<input type="number" min="1" max="99" value={participant.age || ""} disabled={disabled} onChange={(event) => setField("age", event.target.value)} required={role === "학생"} /></label>
      <label>보호자<input value={participant.guardian} disabled={disabled} onChange={(event) => setField("guardian", event.target.value)} /></label>
      <label>본인연락처<input value={participant.selfPhone} disabled={disabled} onChange={(event) => setField("selfPhone", event.target.value)} /></label>
      <label className={role === "학생" ? "is-required" : ""}>보호자연락처<input value={participant.guardianPhone} disabled={disabled} onChange={(event) => setField("guardianPhone", event.target.value)} required={role === "학생"} /></label>
      <label className="wide">교우관계<input value={participant.friends} disabled={disabled} onChange={(event) => setField("friends", event.target.value)} /></label>
      <label className="wide">특이사항<textarea rows="3" value={participant.notes} disabled={disabled} onChange={(event) => setField("notes", event.target.value)} /></label>
    </div>
  );
}

function ApplicantsView({ canAdmin, state, search, setSearch, editingId, setEditingId, onUpdate, onDelete, selectedIds, setSelectedIds, onDeleteSelected }) {
  const rows = state.participants.filter((person) => searchableText(person, state).includes(search.toLowerCase()));
  const editing = state.participants.find((person) => person.id === editingId);
  const selectedVisibleIds = rows.map((person) => person.id).filter((id) => selectedIds.includes(id));
  const allVisibleSelected = rows.length > 0 && selectedVisibleIds.length === rows.length;
  const toggleSelected = (id, checked) => {
    setSelectedIds(checked ? Array.from(new Set([...selectedIds, id])) : selectedIds.filter((selectedId) => selectedId !== id));
  };
  const toggleAllVisible = (checked) => {
    const visibleIds = rows.map((person) => person.id);
    setSelectedIds(checked ? Array.from(new Set([...selectedIds, ...visibleIds])) : selectedIds.filter((id) => !visibleIds.includes(id)));
  };
  return (
    <section className="view is-active">
      <div className="section-heading"><div><h2>참석자 조회</h2><p>역할, 연락처, 조, 사역팀으로 검색합니다.</p></div><input className="search-input" placeholder="검색" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      {canAdmin && (
        <div className="list-toolbar">
          <span>선택 {selectedIds.length}명</span>
          <button className="danger-btn" type="button" onClick={() => onDeleteSelected(selectedIds)} disabled={!selectedIds.length}>선택 삭제</button>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead><tr>{canAdmin && <th className="select-col"><input type="checkbox" checked={allVisibleSelected} onChange={(event) => toggleAllVisible(event.target.checked)} aria-label="현재 목록 전체 선택" /></th>}<th>역할</th><th>이름</th><th>성별</th><th>나이</th><th>보호자</th><th>본인연락처</th><th>보호자연락처</th><th>교우관계</th><th>소속</th><th>특이사항</th><th></th></tr></thead>
          <tbody>
            {rows.map((person) => (
              <tr key={person.id}>
                {canAdmin && <td className="select-col"><input type="checkbox" checked={selectedIds.includes(person.id)} onChange={(event) => toggleSelected(person.id, event.target.checked)} aria-label={`${person.name} 선택`} /></td>}
                <td><RolePill person={person} /></td><td><strong>{person.name}</strong></td><td>{person.gender}</td><td>{person.age || ""}</td><td>{person.guardian}</td><td>{person.selfPhone}</td><td>{person.guardianPhone}</td><td>{renderFriendTags(person.friends)}</td><td>{assignmentNames(person, state).map((name) => <span className="pill" key={name}>{name}</span>)}</td><td>{person.notes}</td>
                <td>{canAdmin && <button className="ghost-btn" type="button" onClick={() => setEditingId(person.id)}>수정</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <EditDialog person={editing} onClose={() => setEditingId("")} onUpdate={onUpdate} onDelete={onDelete} />}
    </section>
  );
}

function EditDialog({ person, onClose, onUpdate, onDelete }) {
  const [draft, setDraft] = useState(person);
  return (
    <dialog open>
      <form className="dialog-form" onSubmit={(event) => { event.preventDefault(); onUpdate(draft); }}>
        <h2>참석자 수정</h2>
        <ParticipantFields participant={draft} setField={(key, value) => setDraft({ ...draft, [key]: value })} />
        <div className="dialog-actions"><button className="danger-btn" type="button" onClick={() => onDelete(person.id)}>삭제</button><span /><button className="ghost-btn" type="button" onClick={onClose}>취소</button><button className="primary-btn" type="submit">저장</button></div>
      </form>
    </dialog>
  );
}

function GroupsView({ canAdmin, state, onGroupCount, onAutoBalance, onAssign, onRemoveTeacher }) {
  return (
    <section className="view is-active">
      <div className="section-heading">
        <div><h2>조 Builder</h2><p>학생은 한 조, 선생님은 여러 조에 배정할 수 있습니다.</p></div>
        <div className="group-controls"><label>조 개수<input type="number" min="1" max="20" defaultValue={state.groups.length} onBlur={(event) => onGroupCount(event.target.value)} disabled={!canAdmin} /></label><button className="primary-btn" type="button" onClick={onAutoBalance} disabled={!canAdmin}>자동 균형 배정</button></div>
      </div>
      <div className="builder-layout">
        <aside className="unassigned panel">
          <h3>미배정 학생</h3>
          <DropList groupId="" canAdmin={canAdmin} onAssign={onAssign}>{state.participants.filter((person) => isStudent(person) && !person.groupId).map((person) => <PersonCard key={person.id} person={person} state={state} />)}</DropList>
          <h3 className="side-heading">선생님 목록</h3>
          <div className="person-list">{state.participants.filter(isTeacher).map((person) => <PersonCard key={person.id} person={person} state={state} />)}</div>
        </aside>
        <div className="group-board">
          {state.groups.map((group) => {
            const students = state.participants.filter((person) => isStudent(person) && person.groupId === group.id);
            const teachers = state.participants.filter((person) => isTeacher(person) && person.groupIds.includes(group.id));
            return (
              <section className="group-card" key={group.id}>
                <header><h3>{group.name}</h3><div className="group-stats">학생 {students.length}명 · 선생님 {teachers.length}명</div></header>
                <DropList groupId={group.id} canAdmin={canAdmin} onAssign={onAssign}>
                  <h4>학생</h4>{students.map((person) => <PersonCard key={person.id} person={person} state={state} />)}
                  <h4>선생님</h4>{teachers.map((person) => <PersonCard key={person.id} person={person} state={state} removableGroupId={group.id} onRemoveTeacher={onRemoveTeacher} />)}
                </DropList>
              </section>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function DropList({ groupId, canAdmin, onAssign, children }) {
  return <div className="person-list drop-target" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (canAdmin) onAssign(event.dataTransfer.getData("text/plain"), groupId); }}>{children}</div>;
}

function PersonCard({ person, state, removableGroupId, onRemoveTeacher }) {
  return (
    <article className={`person-card ${isTeacher(person) ? "teacher-card" : ""}`} draggable onDragStart={(event) => event.dataTransfer.setData("text/plain", person.id)}>
      <strong>{person.name}</strong>
      <div className="person-meta"><RolePill person={person} /><span className={`pill ${person.gender === "남" ? "gender-male" : "gender-female"}`}>{person.gender || "성별 미입력"}</span>{contactPhone(person) && <span className="pill phone-pill">{contactPhone(person)}</span>}</div>
      {isTeacher(person) && person.teamIds.map((teamId) => <span className="pill" key={teamId}>{teamName(teamId, state)}</span>)}
      {removableGroupId && <button className="ghost-btn small-btn card-action" type="button" onClick={() => onRemoveTeacher(person.id, removableGroupId)}>조에서 제외</button>}
    </article>
  );
}

function OrganizationView({ canAdmin, state, search, setSearch, teamName, setTeamName, onAddTeam, onDeleteTeam, onAssignTeacher, onRemoveTeacher }) {
  const teachers = state.participants.filter((person) => isTeacher(person) && searchableText(person, state).includes(search.toLowerCase()));
  return (
    <section className="view is-active">
      <div className="section-heading"><div><h2>조직도</h2><p>사역팀과 조별 선생님 연락처를 확인합니다.</p></div><input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="선생님 검색" /></div>
      {canAdmin && <form className="team-form panel" onSubmit={onAddTeam}><label>새 사역팀 이름<input value={teamName} onChange={(event) => setTeamName(event.target.value)} /></label><button className="primary-btn" type="submit">사역팀 추가</button></form>}
      <div className="organization-board">
        <section className="organization-section"><h3>조별 선생님</h3><div className="organization-grid">{state.groups.map((group) => <OrgCard key={group.id} title={group.name} teachers={teachers.filter((person) => person.groupIds.includes(group.id))} state={state} />)}</div></section>
        <section className="organization-section"><h3>팀별 선생님</h3><div className="organization-grid">{state.teams.map((team) => {
          const teamTeachers = teachers.filter((person) => person.teamIds.includes(team.id));
          const available = state.participants.filter((person) => isTeacher(person) && !person.teamIds.includes(team.id));
          return <OrgCard key={team.id} title={team.name} teachers={teamTeachers} state={state} removableTeamId={team.id} onRemove={onRemoveTeacher} actions={canAdmin && <><button className="ghost-btn small-btn" type="button" onClick={() => onDeleteTeam(team.id)}>삭제</button><select onChange={(event) => { onAssignTeacher(event.target.value, team.id); event.target.value = ""; }}><option value="">선생님 추가</option>{available.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></>} />;
        })}</div></section>
      </div>
    </section>
  );
}

function OrgCard({ title, teachers, state, actions, removableTeamId, onRemove }) {
  return <article className="org-card"><header><h3>{title}</h3><div className="org-actions"><span className="pill">선생님 {teachers.length}명</span>{actions}</div></header><div className="phone-list">{teachers.map((person) => <div className="phone-row" key={person.id}><strong>{person.name}</strong><a href={`tel:${person.selfPhone}`}>{person.selfPhone || "본인연락처 미입력"}</a><small>{assignmentNames(person, state).join(", ")}</small>{removableTeamId && <button className="ghost-btn small-btn" type="button" onClick={() => onRemove(person.id, removableTeamId)}>제거</button>}</div>)}</div></article>;
}

function AttendanceView({ canAttendance, state, setDayLabels, onChange }) {
  const students = state.participants.filter(isStudent).sort((a, b) => primaryAssignment(a, state).localeCompare(primaryAssignment(b, state)));
  return <section className="view is-active"><div className="section-heading"><div><h2>3일 출석부</h2><p>학생만 표시됩니다.</p></div><div className="day-settings">{state.dayLabels.map((label, index) => <input key={index} value={label} onChange={(event) => { const labels = [...state.dayLabels]; labels[index] = event.target.value; setDayLabels(labels); }} />)}</div></div><div className="table-wrap"><table><thead><tr><th>이름</th><th>조</th>{state.dayLabels.map((label) => <th key={label}>{label}</th>)}<th>메모</th></tr></thead><tbody>{students.map((person) => <tr key={person.id}><td><strong>{person.name}</strong></td><td>{primaryAssignment(person, state) || "미배정"}</td>{[1, 2, 3].map((day) => <td key={day}><input className="attendance-check" type="checkbox" disabled={!canAttendance} checked={Boolean(person.attendance?.[`day${day}`])} onChange={(event) => onChange(person.id, `day${day}`, event.target.checked)} /></td>)}<td><input disabled={!canAttendance} value={person.attendance?.memo || ""} onChange={(event) => onChange(person.id, "memo", event.target.value)} /></td></tr>)}</tbody></table></div></section>;
}

function MedicalView({ canMedical, state, search, setSearch, onChange }) {
  const rows = state.participants.filter((person) => `${person.name} ${person.guardian} ${person.selfPhone} ${person.guardianPhone} ${Object.values(person.medical || {}).join(" ")}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="view is-active"><div className="section-heading"><div><h2>의무기록</h2><p>의료인과 관리자만 수정할 수 있습니다.</p></div><input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="검색" /></div><div className="medical-grid">{rows.map((person) => <article className="medical-card" key={person.id}><header><div><h3>{person.name}</h3><div className="medical-meta"><RolePill person={person} /><span className="pill">{primaryAssignment(person, state) || "미배정"}</span>{person.guardianPhone && <span className="pill">보호자 {person.guardianPhone}</span>}</div></div></header><div className="medical-fields">{[["allergies", "알레르기"], ["medication", "복용약"], ["conditions", "질환 / 주의사항"], ["emergencyContact", "응급 연락처"], ["incidentLog", "현장 처치 기록"]].map(([key, label]) => <label key={key}>{label}{key === "emergencyContact" ? <input disabled={!canMedical} value={person.medical?.[key] || ""} onChange={(event) => onChange(person.id, key, event.target.value)} /> : <textarea disabled={!canMedical} value={person.medical?.[key] || ""} onChange={(event) => onChange(person.id, key, event.target.value)} />}</label>)}</div></article>)}</div></section>;
}

function RolePill({ person }) {
  return <span className={`pill ${isTeacher(person) ? "role-teacher" : "role-student"}`}>{normalizeRole(person.role)}</span>;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean).map(parseCsvLine);
  const headers = lines.shift() || [];
  return lines.map((line) => Object.fromEntries(headers.map((header, index) => [header.trim(), line[index] || ""])));
}

function excelRowsToObjects(rows) {
  const [headers = [], ...body] = rows;
  return body.map((row) => Object.fromEntries(headers.map((header, index) => [String(header || "").trim(), row[index] || ""])));
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  values.push(value);
  return values;
}

function rowToParticipant(row) {
  return {
    role: pick(row, ["역할", "role", "Role"]),
    name: pick(row, ["이름", "name", "Name"]),
    gender: normalizeGender(pick(row, ["성별", "gender", "Gender"])),
    age: pick(row, ["나이", "age", "Age"]),
    guardian: pick(row, ["보호자", "guardian", "Guardian"]),
    phone: pick(row, ["연락처", "전화번호", "phone", "Phone"]),
    selfPhone: pick(row, ["본인연락처", "본인 연락처", "selfPhone", "personalPhone"]),
    guardianPhone: pick(row, ["보호자연락처", "보호자 연락처", "guardianPhone", "parentPhone"]),
    friends: pick(row, ["교우관계", "친구", "friends", "Friends"]),
    notes: pick(row, ["특이사항", "메모", "notes", "Notes"]),
  };
}

function pick(row, keys) {
  const found = keys.find((key) => Object.prototype.hasOwnProperty.call(row, key));
  return found ? row[found] : "";
}

function parseList(value) {
  return String(value || "").split(/[,，、]/).map((item) => item.trim()).filter(Boolean);
}

function renderFriendTags(value) {
  return parseList(value).map((friend) => <span className="pill" key={friend}>{friend}</span>);
}

function teamName(teamId, state) {
  return state.teams.find((team) => team.id === teamId)?.name || teamId;
}

function assignmentNames(person, state) {
  if (isTeacher(person)) return [...(person.groupIds || []).map((id) => state.groups.find((group) => group.id === id)?.name).filter(Boolean), ...(person.teamIds || []).map((id) => teamName(id, state))];
  return [state.groups.find((group) => group.id === person.groupId)?.name].filter(Boolean);
}

function primaryAssignment(person, state) {
  return assignmentNames(person, state)[0] || "";
}

function contactPhone(person) {
  return isTeacher(person) ? person.selfPhone : person.guardianPhone || person.selfPhone;
}

function normalizeNameKey(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function hasDuplicateParticipantName(participants, name, exceptId = "") {
  const nameKey = normalizeNameKey(name);
  return Boolean(nameKey) && participants.some((person) => person.id !== exceptId && normalizeNameKey(person.name) === nameKey);
}

function searchableText(person, state) {
  return `${person.role} ${person.name} ${person.gender} ${person.age} ${person.guardian} ${person.selfPhone} ${person.guardianPhone} ${person.friends} ${person.notes} ${assignmentNames(person, state).join(" ")}`.toLowerCase();
}

createRoot(document.getElementById("root")).render(<App />);
