module schach.local/workspace/encore

go 1.26.0

require (
	encore.dev v1.57.13
	gorm.io/driver/postgres v1.6.3
	gorm.io/gorm v1.31.2
	schach.local/workspace/backend v0.0.0
)

require (
	cloud.google.com/go/compute/metadata v0.3.0 // indirect
	github.com/coder/websocket v1.8.15 // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/pgx/v5 v5.10.0 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/jinzhu/inflection v1.0.0 // indirect
	github.com/jinzhu/now v1.1.5 // indirect
	golang.org/x/oauth2 v0.37.0 // indirect
	golang.org/x/sync v0.17.0 // indirect
	golang.org/x/text v0.29.0 // indirect
)

replace schach.local/workspace/backend => ../backend
