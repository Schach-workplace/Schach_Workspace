package platform

import (
	"context"
	"sync"
)

// LocalProviderBudget is process-local admission, never a multi-replica capacity lease.
type LocalProviderBudget interface {
	Acquire(context.Context) (release func(), err error)
}
type localProviderSlots struct{ slots chan struct{} }

func NewLocalProviderBudget(limit int) LocalProviderBudget {
	if limit < 1 {
		limit = 1
	}
	return &localProviderSlots{make(chan struct{}, limit)}
}
func (b *localProviderSlots) Acquire(ctx context.Context) (func(), error) {
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	select {
	case b.slots <- struct{}{}:
		var once sync.Once
		return func() { once.Do(func() { <-b.slots }) }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

var processLocalProviderBudget = NewLocalProviderBudget(1)
