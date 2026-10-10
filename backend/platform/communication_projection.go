package platform

import (
	"gorm.io/gorm"
	"net/http"
)

func communicationWorkAccess(tx *gorm.DB, scope *conversationScope) (*access, error) {
	a := &access{Members: map[string]Membership{}, Users: map[string]User{}}
	if e := tx.First(&a.User, "id=?", scope.UserID).Error; e != nil {
		return nil, e
	}
	if e := tx.First(&a.Company, "id=?", scope.CompanyID).Error; e != nil {
		return nil, e
	}
	var members []Membership
	if e := tx.Where("company_id=?", scope.CompanyID).Find(&members).Error; e != nil {
		return nil, e
	}
	ids := []string{}
	for _, m := range members {
		a.Members[m.UserID] = m
		ids = append(ids, m.UserID)
	}
	a.Member = a.Members[scope.UserID]
	var users []User
	if e := tx.Where("id IN ?", ids).Find(&users).Error; e != nil {
		return nil, e
	}
	for _, u := range users {
		a.Users[u.ID] = u
	}
	return a, nil
}
func (s *Server) conversationTaskSources(w http.ResponseWriter, r *http.Request) error {
	sources := []CommunicationWorkSource{}
	e := s.withCommunicationTransaction(r, nil, func(tx *gorm.DB, scope *conversationScope) error {
		a, e := communicationWorkAccess(tx, scope)
		if e != nil {
			return e
		}
		if _, e = scopedTask(tx, a, r.PathValue("task")); e != nil {
			return e
		}
		var rows []CommunicationWorkSource
		if e := tx.Where("company_id=? AND conversation_id=? AND task_id=?", scope.CompanyID, scope.Conversation.ID, r.PathValue("task")).Find(&rows).Error; e != nil {
			return e
		}
		for _, row := range rows {
			m, e := scopedMessage(tx, scope, row.MessageID)
			if e == nil && !m.Removed {
				row.CurrentRevision = m.Revision
				row.OutOfDate = m.Revision != row.Revision
				sources = append(sources, row)
			}
		}
		return nil
	})
	if e != nil {
		return e
	}
	return respond(w, 200, map[string]any{"sources": sources})
}
