import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SurveyCity } from '../models/survey-city';

/** Path to static survey data in assets. */
const DATA_URL = 'assets/data.json';

/**
 * Loads survey data from static JSON and exposes it as an observable.
 * No backend required.
 */
@Injectable({
  providedIn: 'root'
})
export class MapDataService {
  constructor(private readonly http: HttpClient) {}

  /**
   * Returns an observable of the survey data array.
   * Subscribe in the component and handle loading/error state as needed.
   */
  getSurveyData(): Observable<SurveyCity[]> {
    return this.http.get<SurveyCity[]>(DATA_URL);
  }
}
