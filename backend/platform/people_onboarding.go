package platform

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func peopleSessionEffect() SessionEffect {
	return SessionEffect{Reauthenticate: true, Scope: "account_sessions", DevicesMustReregister: true, CallsMustRejoin: true, OtherCompanyMembershipsPreserved: true}
}
func peopleGrants(d PeopleMembershipDefaults) []PermissionGrantSummary {
	work := "Read and update your assigned or created ordinary work."
	if leadership(d.Role) {
		work = "Read and administer ordinary company work."
	} else if d.Role == "viewer" {
		work = "Read ordinary company work; no work mutations."
	} else if d.Role == "head" {
		work = "Manage ordinary work in your department."
	} else if d.Role == "manager" {
		work = "Manage ordinary work in your reporting subtree."
	}
	finance := "Read your own expense records; independent finance review remains required."
	if financeAuthority(d.Role) {
		finance = "Read company finance records. Approval and payment remain subject to the existing finance role and independent review rules."
	} else if d.Role == "viewer" {
		finance = "Finance access is unavailable."
	} else if d.Role == "head" {
		finance = "Read your department expenses and your own expense records."
	}
	admin := "Company administration is unavailable."
	if leadership(d.Role) {
		admin = "Manage company people within your role ceiling; retain at least one founder."
	}
	return []PermissionGrantSummary{{"ordinary_work", work}, {"finance", finance}, {"administration", admin}, {"private_conversations", "Private conversations require explicit owner invitations."}}
}
func authorizeOnboardingSources(tx *gorm.DB, a *access, intent OnboardingIntent) error {
	if e := peopleAdministration(a); e != nil {
		return e
	}
	if rank(intent.Membership.Role) > rank(a.Member.Role) || intent.Membership.Role == "founder" && a.Member.Role != "founder" {
		return denied()
	}
	if intent.PresetID != "" {
		if _, e := scopedPeoplePreset(tx, a, intent.PresetID, true); e != nil {
			return e
		}
	}
	for _, task := range intent.Tasks {
		t, e := scopedTemplate(tx, a, task.TemplateID, true)
		if e != nil {
			return e
		}
		if t.Kind != "task" {
			return invalid("Select a task template.")
		}
		if task.ProjectID != "" {
			if _, e := scopedProject(tx, a, task.ProjectID); e != nil {
				return e
			}
		}
	}
	return nil
}
func scopedPeoplePreview(tx *gorm.DB, a *access, id, operation string) (PeoplePreview, error) {
	var p PeoplePreview
	if e := peopleAdministration(a); e != nil {
		return p, e
	}
	if e := tx.First(&p, "id=? AND company_id=? AND actor_id=? AND operation=?", id, a.Company.ID, a.User.ID, operation).Error; e != nil {
		return p, missing()
	}
	return p, nil
}
func loadOnboardingManifest(p PeoplePreview) (onboardingManifest, error) {
	var m onboardingManifest
	if e := json.Unmarshal(p.Manifest, &m); e != nil {
		return m, e
	}
	return m, nil
}
func onboardingPreviewView(p PeoplePreview, m onboardingManifest) OnboardingPreviewView {
	v := OnboardingPreviewView{ID: p.ID, Version: p.Version, ExpiresAt: p.ExpiresAt, GraphFingerprint: p.GraphFingerprint, AccountMode: m.AccountMode, MembershipAfter: m.Intent.Membership, Grants: peopleGrants(m.Intent.Membership), TaskPreviews: m.TaskPreviews, Unresolved: m.Unresolved, SessionEffect: peopleSessionEffect()}
	v.Person.Name = m.Intent.Name
	v.Person.Email = m.Intent.Email
	return v
}
func (s *Server) peopleOnboardingPreview(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input struct {
		RetryKey string `json:"retryKey"`
		OnboardingIntent
	}
	if e = decodeBusiness(w, r, &input); e != nil {
		return e
	}
	input.Name = strings.TrimSpace(input.Name)
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	if !clean(input.Name, 120) || !validEmail(input.Email) || len(input.Tasks) > 20 {
		return invalid("Provide a valid name and email, with at most20 onboarding tasks.")
	}
	var out BusinessResult
	var preview PeoplePreview
	var manifest onboardingManifest
	e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
		authorize := func() error { return authorizeOnboardingSources(tx, a, input.OnboardingIntent) }
		authorizeResult := func(result BusinessResult) error {
			var e error
			preview, e = scopedPeoplePreview(tx, a, result.IDs[0], "onboard")
			if e != nil {
				return e
			}
			manifest, e = loadOnboardingManifest(preview)
			if e != nil {
				return e
			}
			return authorizeOnboardingSources(tx, a, manifest.Intent)
		}
		out, e = businessMutation(tx, a, "onboarding_preview", input.RetryKey, input.OnboardingIntent, authorize, authorizeResult, func() (BusinessResult, error) {
			if e := validatePeopleDefaults(tx, a, input.Membership, ""); e != nil {
				return BusinessResult{}, e
			}
			if input.PresetID != "" {
				p, e := scopedPeoplePreset(tx, a, input.PresetID, true)
				if e != nil {
					return BusinessResult{}, e
				}
				if input.ExpectedPresetVersion < 1 || p.Version != input.ExpectedPresetVersion {
					return BusinessResult{}, conflict()
				}
			}
			var user User
			mode := "existing_account"
			err := tx.First(&user, "email=?", input.Email).Error
			if err == gorm.ErrRecordNotFound {
				user = User{ID: newID("usr"), Name: input.Name, Email: input.Email, SessionEpoch: 1}
				mode = "new_account"
			} else if err != nil {
				return BusinessResult{}, err
			} else if user.Suspended {
				return BusinessResult{}, invalid("A suspended account cannot join a company.")
			}
			if _, exists := a.Members[user.ID]; exists {
				return BusinessResult{}, invalid("This account already has a membership. Use explicit edit or rejoin.")
			}
			manifest = onboardingManifest{Intent: input.OnboardingIntent, AccountMode: mode, UserID: user.ID, MembershipID: newID("mem"), TaskPreviews: []TemplateTaskPreview{}, Unresolved: []FieldRequirement{}}
			manifest.Intent.Name = user.Name
			graph := peopleGraphFingerprint(a)
			scope := *a
			scope.Members = cloneMembers(a.Members)
			scope.Users = map[string]User{}
			for id, u := range a.Users {
				scope.Users[id] = u
			}
			scope.Users[user.ID] = user
			scope.Members[user.ID] = proposedOnboardingMember(a.Company.ID, manifest)
			for i, task := range input.Tasks {
				template, e := scopedTemplate(tx, a, task.TemplateID, true)
				if e != nil {
					return BusinessResult{}, e
				}
				fields, unresolved, e := templateFields(tx, &scope, template, task.templateInput(), true)
				if e != nil {
					return BusinessResult{}, e
				}
				for _, field := range unresolved {
					manifest.Unresolved = append(manifest.Unresolved, FieldRequirement{Field: "tasks[" + strconv.Itoa(i) + "]." + field, Message: "Choose a current eligible person."})
				}
				if len(unresolved) == 0 {
					if e := authorizeTaskCreation(tx, &scope, fields); e != nil {
						return BusinessResult{}, e
					}
				}
				manifest.TaskPreviews = append(manifest.TaskPreviews, TemplateTaskPreview{TemplateID: task.TemplateID, TemplateVersion: template.Version, ProjectVersion: task.ExpectedProjectVersion, Fields: fields})
			}
			now := time.Now().UTC()
			intent, _ := json.Marshal(manifest.Intent)
			body, _ := json.Marshal(manifest)
			hash, e := businessHash(manifest.Intent)
			if e != nil {
				return BusinessResult{}, e
			}
			preview = PeoplePreview{ID: newID("pp"), CompanyID: a.Company.ID, ActorID: a.User.ID, Operation: "onboard", Version: 1, TargetUserID: user.ID, TargetMembershipID: manifest.MembershipID, GraphFingerprint: graph, IntentHash: hash, CompanyEpoch: a.Company.PermissionEpoch, Timezone: a.Company.Timezone, Intent: intent, Manifest: body, CreatedAt: now, ExpiresAt: now.Add(30 * time.Minute)}
			if e := tx.Create(&preview).Error; e != nil {
				return BusinessResult{}, e
			}
			return BusinessResult{Kind: "people_preview", IDs: []string{preview.ID}, Versions: []int64{1}}, nil
		})
		return e
	})
	_ = out
	if e != nil {
		return e
	}
	return respond(w, 200, onboardingPreviewView(preview, manifest))
}
func proposedOnboardingMember(cid string, m onboardingManifest) Membership {
	d := m.Intent.Membership
	return Membership{ID: m.MembershipID, CompanyID: cid, UserID: m.UserID, Version: 1, AccessEpoch: 1, Role: d.Role, DepartmentID: d.DepartmentID, ManagerID: d.ManagerID, Title: d.Title, CapacityHours: d.CapacityHours, Active: true}
}
func authorizeOnboardingApplication(tx *gorm.DB, a *access, id string) (OnboardingApplication, error) {
	var app OnboardingApplication
	if e := peopleAdministration(a); e != nil {
		return app, e
	}
	if e := tx.First(&app, "id=? AND company_id=? AND actor_id=?", id, a.Company.ID, a.User.ID).Error; e != nil {
		return app, missing()
	}
	p, e := scopedPeoplePreview(tx, a, app.PreviewID, "onboard")
	if e != nil {
		return app, e
	}
	m, e := loadOnboardingManifest(p)
	if e != nil {
		return app, e
	}
	if e := authorizeOnboardingSources(tx, a, m.Intent); e != nil {
		return app, e
	}
	for _, id := range app.TaskIDs {
		if _, e := scopedTask(tx, a, id); e != nil {
			return app, e
		}
	}
	return app, nil
}

// Only immutable business intent enters common canonical hashing; password and
// both slow derivations stay outside row-lock transactions and persisted DTOs.
func (s *Server) peopleOnboardingApply(w http.ResponseWriter, r *http.Request) error {
	a, e := s.access(r)
	if e != nil {
		return e
	}
	var input struct {
		RetryKey               string          `json:"retryKey"`
		PreviewID              string          `json:"previewId"`
		ExpectedPreviewVersion int64           `json:"expectedPreviewVersion"`
		Password               json.RawMessage `json:"password"`
	}
	if e = decodeCredentialRequest(w, r, &input); e != nil {
		return e
	}
	if !clean(input.RetryKey, 100) || input.ExpectedPreviewVersion < 1 {
		return invalid("A retry key and captured preview version are required.")
	}
	var password string
	if input.Password != nil {
		if json.Unmarshal(input.Password, &password) != nil {
			return invalid("A valid password is required.")
		}
	}
	defer clear(input.Password)
	var app OnboardingApplication
	charged := false
	for restart := 0; restart < 3; restart++ {
		var preview PeoplePreview
		var manifest onboardingManifest
		var stored BusinessMutationRetry
		var binding *CredentialRetryBinding
		var canonical []byte
		var intent any
		committed := false
		e = s.withAccessTransaction(r, a, func(tx *gorm.DB) error {
			var e error
			preview, e = scopedPeoplePreview(tx, a, input.PreviewID, "onboard")
			if e != nil {
				return e
			}
			manifest, e = loadOnboardingManifest(preview)
			if e != nil {
				return e
			}
			if e := authorizeOnboardingSources(tx, a, manifest.Intent); e != nil {
				return e
			}
			intent = []any{input.PreviewID, input.ExpectedPreviewVersion, manifest.AccountMode, manifest.Intent}
			canonical, e = businessCanonicalBytes(intent)
			if e != nil {
				return e
			}
			err := tx.First(&stored, "company_id=? AND actor_id=? AND operation='onboarding_apply' AND retry_key=?", a.Company.ID, a.User.ID, input.RetryKey).Error
			if err == nil {
				committed = true
				hash, e := businessHash(intent)
				if e != nil {
					return e
				}
				if hash != stored.RequestHash {
					return conflict()
				}
				if len(stored.ResultIDs) != 1 {
					return conflict()
				}
				if _, e = authorizeOnboardingApplication(tx, a, stored.ResultIDs[0]); e != nil {
					return e
				}
				binding = stored.CredentialBinding
			} else if err != gorm.ErrRecordNotFound {
				return err
			}
			if manifest.AccountMode == "existing_account" {
				if input.Password != nil {
					return invalid("Existing-account onboarding preserves credentials. Omit the password field.")
				}
				return nil
			}
			if input.Password == nil {
				return invalid("A new account requires a password.")
			}
			if e := validatePassword(password); e != nil {
				return e
			}
			if committed {
				return validateCredentialBinding(s.opts, binding, true)
			}
			binding, e = newCredentialBinding(s.opts)
			return e
		})
		if e != nil {
			return e
		}
		var loginHash string
		var verifier []byte
		if manifest.AccountMode == "new_account" {
			if !charged {
				if e = s.credentialAdmission.charge(s.opts, a.Company.ID, a.User.ID, false); e != nil {
					w.Header().Set("Retry-After", "5")
					return e
				}
				charged = true
			}
			e = s.credentialAdmission.run(r.Context(), s.opts.CredentialRetryQueueWait, func() error {
				var err error
				if !committed {
					loginHash, err = passwordHash(password)
					if err != nil {
						return err
					}
				}
				verifier, err = deriveCredential(s.opts, binding, a.Company.ID, a.User.ID, input.RetryKey, canonical, password)
				return err
			})
			if e != nil {
				w.Header().Set("Retry-After", "5")
				return e
			}
		}
		mismatch := false
		e = s.withPeopleAccessTransaction(r, a, []string{manifest.UserID}, func(tx *gorm.DB) error {
			if e := authorizeOnboardingSources(tx, a, manifest.Intent); e != nil {
				return e
			}
			// The same durable identity is used by every business mutation. Metadata
			// compare occurs before its existing canonical lookup; no second retry row.
			var winner BusinessMutationRetry
			err := tx.First(&winner, "company_id=? AND actor_id=? AND operation='onboarding_apply' AND retry_key=?", a.Company.ID, a.User.ID, input.RetryKey).Error
			if err == nil {
				expectedHash, e := businessHash(intent)
				if e != nil {
					return e
				}
				if winner.RequestHash != expectedHash {
					return conflict()
				}
				if len(winner.ResultIDs) != 1 {
					return conflict()
				}
				if _, e := authorizeOnboardingApplication(tx, a, winner.ResultIDs[0]); e != nil {
					return e
				}
				if manifest.AccountMode == "new_account" {
					if e := validateCredentialBinding(s.opts, winner.CredentialBinding, true); e != nil {
						return e
					}
					if !sameCredentialMetadata(binding, winner.CredentialBinding) {
						return errCredentialWinner
					}
					if subtle.ConstantTimeCompare(verifier, winner.CredentialBinding.Verifier) != 1 {
						mismatch = true
						return conflict()
					}
				}
			} else if err != gorm.ErrRecordNotFound {
				return err
			}
			out, e := businessMutation(tx, a, "onboarding_apply", input.RetryKey, intent, func() error { return authorizeOnboardingSources(tx, a, manifest.Intent) }, func(out BusinessResult) error {
				var e error
				app, e = authorizeOnboardingApplication(tx, a, out.IDs[0])
				return e
			}, func() (BusinessResult, error) {
				if preview.Version != input.ExpectedPreviewVersion || !preview.ExpiresAt.After(time.Now().UTC()) || preview.AppliedResultID != "" || preview.GraphFingerprint != peopleGraphFingerprint(a) {
					return BusinessResult{}, conflict()
				}
				if len(manifest.Unresolved) > 0 {
					return BusinessResult{}, invalid("Resolve every onboarding assignment before applying.")
				}
				if manifest.Intent.PresetID != "" {
					p, e := scopedPeoplePreset(tx, a, manifest.Intent.PresetID, true)
					if e != nil {
						return BusinessResult{}, e
					}
					if p.Version != manifest.Intent.ExpectedPresetVersion {
						return BusinessResult{}, conflict()
					}
				}
				before := cloneMembers(a.Members)
				if _, exists := before[manifest.UserID]; exists {
					return BusinessResult{}, conflict()
				}
				var current User
				err := tx.First(&current, "email=?", manifest.Intent.Email).Error
				if manifest.AccountMode == "new_account" {
					if err == nil {
						return BusinessResult{}, conflict()
					}
					if err != gorm.ErrRecordNotFound {
						return BusinessResult{}, err
					}
					current = User{ID: manifest.UserID, Name: manifest.Intent.Name, Email: manifest.Intent.Email, PasswordHash: loginHash, SessionEpoch: 1}
					res := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&current)
					if res.Error != nil {
						return BusinessResult{}, res.Error
					}
					if res.RowsAffected != 1 {
						return BusinessResult{}, conflict()
					}
				} else {
					if err != nil || current.ID != manifest.UserID {
						return BusinessResult{}, conflict()
					}
					if current.Suspended {
						return BusinessResult{}, invalid("A suspended account cannot join a company.")
					}
				}
				a.Users[current.ID] = current
				member := proposedOnboardingMember(a.Company.ID, manifest)
				if e := validateMember(tx, a, member); e != nil {
					return BusinessResult{}, e
				}
				if e := tx.Create(&member).Error; e != nil {
					return BusinessResult{}, e
				}
				a.Members[member.UserID] = member
				app = OnboardingApplication{ID: newID("onboard"), CompanyID: a.Company.ID, ActorID: a.User.ID, PreviewID: preview.ID, PresetID: manifest.Intent.PresetID, PresetVersion: manifest.Intent.ExpectedPresetVersion, UserID: current.ID, MembershipID: member.ID, TaskIDs: []string{}, TaskVersions: []int64{}, CreatedAt: nowString()}
				for _, task := range manifest.Intent.Tasks {
					template, e := scopedTemplate(tx, a, task.TemplateID, true)
					if e != nil {
						return BusinessResult{}, e
					}
					result, e := applyTaskTemplateTx(tx, a, template, task.templateInput(), input.RetryKey)
					if e != nil {
						return BusinessResult{}, e
					}
					app.TaskIDs = append(app.TaskIDs, result.IDs...)
					app.TaskVersions = append(app.TaskVersions, result.Versions...)
				}
				effects, e := finalizeMembershipConsequences(tx, a, before, a.Members, "Reviewed onboarding.", "onboarding_applied")
				if e != nil {
					return BusinessResult{}, e
				}
				app.SessionEffect = effects.SessionEffect
				app.CompanyPermissionEpoch = effects.CompanyEpoch
				if e := tx.Create(&app).Error; e != nil {
					return BusinessResult{}, e
				}
				if e := tx.Model(&PeoplePreview{}).Where("id=? AND applied_result_id=''", preview.ID).Update("applied_result_id", app.ID).Error; e != nil {
					return BusinessResult{}, e
				}
				if e := audit(tx, a.Company.ID, "", a.User.ID, "onboarding_applied", app.ID+": reviewed company onboarding."); e != nil {
					return BusinessResult{}, e
				}
				return BusinessResult{Kind: "onboarding", IDs: []string{app.ID}, Versions: []int64{1}}, nil
			})
			if e != nil {
				return e
			}
			if manifest.AccountMode == "new_account" && err == gorm.ErrRecordNotFound {
				storedBinding := *binding
				storedBinding.Verifier = verifier
				if e := tx.Model(&BusinessMutationRetry{}).Where("company_id=? AND actor_id=? AND operation='onboarding_apply' AND retry_key=?", a.Company.ID, a.User.ID, input.RetryKey).Updates(BusinessMutationRetry{CredentialBinding: &storedBinding}).Error; e != nil {
					return e
				}
			}
			_ = out
			return nil
		})
		clear(verifier)
		if errors.Is(e, errCredentialWinner) {
			continue
		}
		if mismatch {
			_ = s.credentialAdmission.charge(s.opts, a.Company.ID, a.User.ID, true)
		}
		if e != nil {
			return e
		}
		return respond(w, 200, map[string]any{"ok": true, "id": app.ID, "userId": app.UserID, "membershipId": app.MembershipID, "taskIds": app.TaskIDs, "sessionEffect": app.SessionEffect, "companyPermissionEpoch": app.CompanyPermissionEpoch})
	}
	return &apiError{409, "retry_metadata_changed", "Concurrent onboarding changed the retry binding. Retry the same submitted request.", nil}
}
