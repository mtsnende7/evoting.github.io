/**
 * E-VOTING MTs NEGERI 1 ENDE - GOOGLE APPS SCRIPT BACKEND ENGINE
 * Menggunakan LockService dan Security Patch untuk Mencegah Password Leak
 */

function doGet(e) {
  var template = HtmlService.createTemplateFromFile('index');
  return template.evaluate()
    .setTitle('E-Voting Guru - MTs Negeri 1 Ende')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getDb() {
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  if (!ss) {
    var props = PropertiesService.getScriptProperties();
    var savedId = props.getProperty('DB_SPREADSHEET_ID_GURU');
    if (savedId) { try { ss = SpreadsheetApp.openById(savedId); } catch (e) { ss = null; } }
  }
  if (!ss) {
    var files = DriveApp.getFilesByName("DB E-Voting Guru MTsN1");
    if (files.hasNext()) { ss = SpreadsheetApp.open(files.next()); } 
    else { ss = SpreadsheetApp.create("DB E-Voting Guru MTsN1"); }
    PropertiesService.getScriptProperties().setProperty('DB_SPREADSHEET_ID_GURU', ss.getId());
  }
  return ss;
}

function initSheets() {
  var ss = getDb();
  var shCand = ss.getSheetByName('Kandidat');
  if (!shCand) { shCand = ss.insertSheet('Kandidat'); shCand.appendRow(['ID', 'Kategori', 'Nama', 'NIP', 'Role', 'Foto']); }
  var shVoter = ss.getSheetByName('Pemilih');
  if (!shVoter) { shVoter = ss.insertSheet('Pemilih'); shVoter.appendRow(['ID', 'Nama', 'Kode', 'SudahMemilih', 'VoteDataJSON']); }
  var shAdmin = ss.getSheetByName('Admin');
  if (!shAdmin) { shAdmin = ss.insertSheet('Admin'); shAdmin.appendRow(['ID', 'Nama', 'Username', 'Pass', 'Role', 'Foto']); shAdmin.appendRow(['adm-1', 'Panitia MTsN1', 'admin', 'admin123', 'Super Admin', 'https://placehold.co/150x150/065f46/ffffff?text=Admin']); }
  var shSetting = ss.getSheetByName('Pengaturan');
  if (!shSetting) { shSetting = ss.insertSheet('Pengaturan'); shSetting.appendRow(['Key', 'Value']); shSetting.appendRow(['isPollingActive', 'true']); }
  return ss;
}

function getInitialData() {
  try {
    var ss = initSheets();
    
    // 1. Fetch Kandidat
    var shCand = ss.getSheetByName('Kandidat');
    var candValues = shCand.getDataRange().getValues();
    var candidates = [];
    for (var i = 1; i < candValues.length; i++) {
      if (candValues[i][0]) {
        candidates.push({ id: String(candValues[i][0]), category: String(candValues[i][1]), name: String(candValues[i][2]), nip: String(candValues[i][3]), role: String(candValues[i][4]), photo: String(candValues[i][5]) });
      }
    }
    
    // 2. Fetch Pemilih
    var shVoter = ss.getSheetByName('Pemilih');
    var voterValues = shVoter.getDataRange().getValues();
    var voters = [];
    for (var j = 1; j < voterValues.length; j++) {
      if (voterValues[j][0]) {
        var voteData = null; try { voteData = voterValues[j][4] ? JSON.parse(voterValues[j][4]) : null; } catch (e) {}
        voters.push({ id: String(voterValues[j][0]), name: String(voterValues[j][1]), code: String(voterValues[j][2]), hasVoted: voterValues[j][3] === true || String(voterValues[j][3]).toLowerCase() === 'true', voteData: voteData });
      }
    }
    
    // 3. Fetch Admin (SECURITY PATCH: Jangan pernah kirim Password (indeks ke-3) ke Frontend saat inisialisasi!)
    var shAdmin = ss.getSheetByName('Admin');
    var adminValues = shAdmin.getDataRange().getValues();
    var admins = [];
    for (var k = 1; k < adminValues.length; k++) {
      if (adminValues[k][0]) {
        admins.push({ id: String(adminValues[k][0]), name: String(adminValues[k][1]), username: String(adminValues[k][2]), role: String(adminValues[k][4] || 'Admin'), photo: String(adminValues[k][5] || 'https://placehold.co/150x150/065f46/ffffff?text=Admin') });
      }
    }

    // 4. Fetch Pengaturan
    var shSetting = ss.getSheetByName('Pengaturan');
    var setValues = shSetting.getDataRange().getValues();
    var isPollingActive = true;
    for (var m = 1; m < setValues.length; m++) { if (setValues[m][0] === 'isPollingActive') isPollingActive = String(setValues[m][1]).toLowerCase() === 'true'; }
    
    return { status: 'ok', candidates: candidates, voters: voters, admins: admins, isPollingActive: isPollingActive };
  } catch (err) {
    return { status: 'error', message: err.toString() };
  }
}

// SECURITY PATCH: Verifikasi login langsung dari Database, mencegah pembobolan dari inspect element frontend.
function verifyAdminLogin(username, password) {
  var ss = initSheets();
  var shAdmin = ss.getSheetByName('Admin');
  var adminValues = shAdmin.getDataRange().getValues();
  for (var k = 1; k < adminValues.length; k++) {
    if (adminValues[k][2] == username && adminValues[k][3] == password) {
      return {
        success: true,
        admin: { id: String(adminValues[k][0]), name: String(adminValues[k][1]), username: String(adminValues[k][2]), role: String(adminValues[k][4] || 'Admin'), photo: String(adminValues[k][5] || 'https://placehold.co/150x150/065f46/ffffff?text=Admin') }
      };
    }
  }
  return { success: false };
}

function saveAdminToSheet(adm) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var ss = initSheets(); var sh = ss.getSheetByName('Admin'); var data = sh.getDataRange().getValues(); var foundRow = -1;
    for (var i = 1; i < data.length; i++) { if (String(data[i][0]) === String(adm.id)) { foundRow = i + 1; break; } }
    
    if (foundRow > -1) {
      // Jika form password dikosongkan (artinya tidak ingin ubah password), kita pertahankan password yang lama di DB.
      var oldPass = data[foundRow - 1][3];
      var finalPass = adm.pass ? adm.pass : oldPass;
      sh.getRange(foundRow, 1, 1, 6).setValues([[adm.id, adm.name, adm.username, finalPass, adm.role, adm.photo || '']]);
    } else {
      sh.appendRow([adm.id, adm.name, adm.username, adm.pass, adm.role, adm.photo || '']);
    }
    return true;
  } finally { lock.releaseLock(); }
}

function deleteAdminFromSheet(id) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var ss = initSheets(); var sh = ss.getSheetByName('Admin'); var data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) { if (String(data[i][0]) === String(id)) { sh.deleteRow(i + 1); break; } }
    return true;
  } finally { lock.releaseLock(); }
}

function saveCandidateToSheet(cand) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var ss = initSheets(); var sh = ss.getSheetByName('Kandidat'); var data = sh.getDataRange().getValues(); var foundRow = -1;
    for (var i = 1; i < data.length; i++) { if (String(data[i][0]) === String(cand.id)) { foundRow = i + 1; break; } }
    if (foundRow > -1) sh.getRange(foundRow, 1, 1, 6).setValues([[cand.id, cand.category, cand.name, cand.nip, cand.role, cand.photo]]);
    else sh.appendRow([cand.id, cand.category, cand.name, cand.nip, cand.role, cand.photo]);
    return true;
  } finally { lock.releaseLock(); }
}

function deleteCandidateFromSheet(id) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var ss = initSheets(); var sh = ss.getSheetByName('Kandidat'); var data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) { if (String(data[i][0]) === String(id)) { sh.deleteRow(i + 1); break; } }
    return true;
  } finally { lock.releaseLock(); }
}

function saveVoterToSheet(voter) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var ss = initSheets(); var sh = ss.getSheetByName('Pemilih'); var data = sh.getDataRange().getValues(); var foundRow = -1;
    for (var i = 1; i < data.length; i++) { if (String(data[i][0]) === String(voter.id)) { foundRow = i + 1; break; } }
    var voteJson = voter.voteData ? JSON.stringify(voter.voteData) : '';
    if (foundRow > -1) sh.getRange(foundRow, 1, 1, 5).setValues([[voter.id, voter.name, voter.code, voter.hasVoted, voteJson]]);
    else sh.appendRow([voter.id, voter.name, voter.code, voter.hasVoted, voteJson]);
    return true;
  } finally { lock.releaseLock(); }
}

function saveVotersBulkToSheet(votersArray) {
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var ss = initSheets(); var sh = ss.getSheetByName('Pemilih'); var startRow = sh.getLastRow() + 1;
    if (votersArray.length === 0) return true;
    var rowsData = [];
    for(var i = 0; i < votersArray.length; i++){ var v = votersArray[i]; rowsData.push([v.id, v.name, v.code, v.hasVoted, v.voteData ? JSON.stringify(v.voteData) : '']); }
    sh.getRange(startRow, 1, rowsData.length, 5).setValues(rowsData);
    return true;
  } finally { lock.releaseLock(); }
}

function deleteVoterFromSheet(id) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var ss = initSheets(); var sh = ss.getSheetByName('Pemilih'); var data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) { if (String(data[i][0]) === String(id)) { sh.deleteRow(i + 1); break; } }
    return true;
  } finally { lock.releaseLock(); }
}

function setPollingStatusInSheet(isActive) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var ss = initSheets(); var sh = ss.getSheetByName('Pengaturan'); var data = sh.getDataRange().getValues(); var foundRow = -1;
    for (var i = 1; i < data.length; i++) { if (data[i][0] === 'isPollingActive') { foundRow = i + 1; break; } }
    if (foundRow > -1) sh.getRange(foundRow, 2).setValue(isActive ? 'true' : 'false'); else sh.appendRow(['isPollingActive', isActive ? 'true' : 'false']);
    return true;
  } finally { lock.releaseLock(); }
}

function resetAllVotesInSheet() {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var ss = initSheets(); var sh = ss.getSheetByName('Pemilih'); var data = sh.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) { sh.getRange(i + 1, 4).setValue(false); sh.getRange(i + 1, 5).setValue(''); }
    return true;
  } finally { lock.releaseLock(); }
}

function resetAndRegenerateCodesInSheet(newVotersData) {
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var ss = initSheets(); var sh = ss.getSheetByName('Pemilih'); var data = sh.getDataRange().getValues();
    var codeMap = {}; newVotersData.forEach(function(v) { codeMap[v.id] = v.code; });
    for (var i = 1; i < data.length; i++) {
      var vId = String(data[i][0]);
      if (codeMap[vId]) { sh.getRange(i + 1, 3).setValue(codeMap[vId]); sh.getRange(i + 1, 4).setValue(false); sh.getRange(i + 1, 5).setValue(''); }
    }
    return true;
  } finally { lock.releaseLock(); }
}