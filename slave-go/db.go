package main

import (
	"database/sql"
	"fmt"
	"strings"
	"sync"

	_ "github.com/go-sql-driver/mysql"
)

type Record map[string]string

var (
	db   *sql.DB
	dbMu sync.RWMutex
)

func connectMySQL() error {
	var err error
	db, err = sql.Open("mysql", "root:root123@tcp(127.0.0.1:3306)/")
	if err != nil {
		return fmt.Errorf("failed to open MySQL: %v", err)
	}
	if err = db.Ping(); err != nil {
		return fmt.Errorf("failed to ping MySQL: %v", err)
	}
	return nil
}

// ---------- Apply Replication ----------

func applyCreateDB(name string) {
	db.Exec(fmt.Sprintf("CREATE DATABASE IF NOT EXISTS `%s`", name))
}

func applyDropDB(name string) {
	db.Exec(fmt.Sprintf("DROP DATABASE IF EXISTS `%s`", name))
}

func applyCreateTable(dbName, tableName string, columns []string) {
	cols := "id INT AUTO_INCREMENT PRIMARY KEY"
	for _, c := range columns {
		cols += fmt.Sprintf(", `%s` VARCHAR(255)", c)
	}
	db.Exec(fmt.Sprintf("CREATE TABLE IF NOT EXISTS `%s`.`%s` (%s)", dbName, tableName, cols))
}

func applyDeleteTable(dbName, tableName string) {
	db.Exec(fmt.Sprintf("DROP TABLE IF EXISTS `%s`.`%s`", dbName, tableName))
}

func applyInsert(dbName, tableName, id string, record Record) {
	cols := []string{}
	vals := []interface{}{id}
	placeholders := []string{"?"}
	for k, v := range record {
		cols = append(cols, fmt.Sprintf("`%s`", k))
		vals = append(vals, v)
		placeholders = append(placeholders, "?")
	}
	db.Exec(fmt.Sprintf(
		"INSERT INTO `%s`.`%s` (id, %s) VALUES (%s)",
		dbName, tableName,
		strings.Join(cols, ", "),
		strings.Join(placeholders, ", "),
	), vals...)
}

func applyUpdate(dbName, tableName, id string, updates Record) {
	sets := []string{}
	vals := []interface{}{}
	for k, v := range updates {
		sets = append(sets, fmt.Sprintf("`%s` = ?", k))
		vals = append(vals, v)
	}
	vals = append(vals, id)
	db.Exec(fmt.Sprintf(
		"UPDATE `%s`.`%s` SET %s WHERE id = ?",
		dbName, tableName, strings.Join(sets, ", "),
	), vals...)
}

func applyDelete(dbName, tableName, id string) {
	db.Exec(fmt.Sprintf("DELETE FROM `%s`.`%s` WHERE id = ?", dbName, tableName), id)
}

func applyFullSync(snapshot map[string]interface{}) {
	for dbName, dbData := range snapshot {
		applyCreateDB(dbName)
		tables, ok := dbData.(map[string]interface{})
		if !ok { continue }
		for tableName, tableData := range tables {
			td, ok := tableData.(map[string]interface{})
			if !ok { continue }
			colsRaw, _ := td["columns"].([]interface{})
			cols := []string{}
			for _, c := range colsRaw { cols = append(cols, fmt.Sprintf("%v", c)) }
			applyCreateTable(dbName, tableName, cols)
			rowsRaw, _ := td["rows"].([]interface{})
			for _, rowRaw := range rowsRaw {
				row, ok := rowRaw.(map[string]interface{})
				if !ok { continue }
				id := fmt.Sprintf("%v", row["id"])
				record := Record{}
				for k, v := range row {
					if k != "id" { record[k] = fmt.Sprintf("%v", v) }
				}
				applyInsert(dbName, tableName, id, record)
			}
		}
	}
}

// ---------- Read Operations ----------

func selectRecords(dbName, tableName string) ([]map[string]string, error) {
	dbMu.RLock()
	defer dbMu.RUnlock()
	return queryRows(fmt.Sprintf("SELECT * FROM `%s`.`%s`", dbName, tableName))
}

func searchRecords(dbName, tableName, field, value string) ([]map[string]string, error) {
	dbMu.RLock()
	defer dbMu.RUnlock()
	return queryRows(
		fmt.Sprintf("SELECT * FROM `%s`.`%s` WHERE `%s` LIKE ?", dbName, tableName, field),
		"%"+value+"%",
	)
}

func listDBs() ([]string, error) {
	rows, err := db.Query("SHOW DATABASES")
	if err != nil { return nil, err }
	defer rows.Close()
	system := map[string]bool{"information_schema": true, "mysql": true, "performance_schema": true, "sys": true}
	var dbs []string
	for rows.Next() {
		var name string
		rows.Scan(&name)
		if !system[name] { dbs = append(dbs, name) }
	}
	return dbs, nil
}

func listTables(dbName string) ([]string, error) {
	rows, err := db.Query(fmt.Sprintf("SHOW TABLES IN `%s`", dbName))
	if err != nil { return nil, err }
	defer rows.Close()
	var tables []string
	for rows.Next() {
		var t string
		rows.Scan(&t)
		tables = append(tables, t)
	}
	return tables, nil
}

func getColumns(dbName, tableName string) ([]string, error) {
	rows, err := db.Query(fmt.Sprintf("SHOW COLUMNS FROM `%s`.`%s`", dbName, tableName))
	if err != nil { return nil, err }
	defer rows.Close()
	var cols []string
	for rows.Next() {
		var field, typ, null, key, def, extra sql.NullString
		rows.Scan(&field, &typ, &null, &key, &def, &extra)
		if field.String != "id" { cols = append(cols, field.String) }
	}
	return cols, nil
}

func queryRows(query string, args ...interface{}) ([]map[string]string, error) {
	rows, err := db.Query(query, args...)
	if err != nil { return nil, err }
	defer rows.Close()
	cols, _ := rows.Columns()
	var results []map[string]string
	for rows.Next() {
		vals := make([]interface{}, len(cols))
		ptrs := make([]interface{}, len(cols))
		for i := range vals { ptrs[i] = &vals[i] }
		rows.Scan(ptrs...)
		row := map[string]string{}
		for i, col := range cols {
			if vals[i] != nil { row[col] = fmt.Sprintf("%s", vals[i]) } else { row[col] = "" }
		}
		results = append(results, row)
	}
	return results, nil
}